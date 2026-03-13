import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';
import { createDatabase } from '../db/index.js';
import { createServer } from '../server/index.js';
import { createWorkerLoop } from '../worker/loop.js';
import { recoverStaleTasks } from '../worker/recovery.js';
import { getProjectByPath, createProject, listProjects, deleteProject } from '../db/queries.js';
import type { AgentboardConfig } from '../types/index.js';
import type Database from 'better-sqlite3';

interface RegistryEntry {
  path: string;
  name: string;
  registeredAt: string;
}

export default async function up(opts: {
  port?: string;
}): Promise<void> {
  const cwd = process.cwd();
  const abDir = path.join(cwd, '.agentboard');

  // Clean up stale shutdown file from a previous crash
  const staleShutdown = path.join(abDir, 'shutdown');
  if (fs.existsSync(staleShutdown)) {
    fs.unlinkSync(staleShutdown);
  }

  const configPath = path.join(abDir, 'config.json');

  if (!fs.existsSync(configPath)) {
    console.error(
      chalk.red(
        'Error: .agentboard/config.json not found. Run `agentboard init` first.'
      )
    );
    process.exit(1);
  }

  // 1. Load config
  const config: AgentboardConfig = JSON.parse(
    fs.readFileSync(configPath, 'utf-8')
  ) as AgentboardConfig;

  // Override port from CLI flag
  if (opts.port) {
    config.port = parseInt(opts.port, 10);
  }

  // 2. Open database
  const dbPath = path.join(cwd, '.agentboard', 'agentboard.db');
  const db = createDatabase(dbPath);

  // 3. Sync projects from global registry
  syncProjectsFromRegistry(db);

  // 4. Start server
  const { server, io } = createServer(db, config, { configPath });

  // Wait for server to actually start listening (or fail)
  await new Promise<void>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(
          chalk.red(`Error: Port ${config.port} is already in use.`),
          chalk.yellow(`\nRun \`agentboard down\` or \`lsof -ti :${config.port} | xargs kill\` to free it.`)
        );
      } else {
        console.error(chalk.red(`Server error: ${err.message}`));
      }
      db.close();
      reject(err);
    });
    server.listen(config.port, config.host, () => resolve());
  });

  console.log(
    chalk.green.bold(
      `Agentboard running at http://${config.host}:${config.port}`
    )
  );

  // 5. Crash recovery: recover stale tasks
  const recovered = recoverStaleTasks(db);
  if (recovered > 0) {
    console.log(chalk.yellow(`Recovered ${recovered} stale task(s) from previous crash`));
  }

  // 6. Start worker loop
  const worker = createWorkerLoop(db, config, io);
  worker.start();

  // 7. Watch for shutdown file
  const shutdownPath = path.join(cwd, '.agentboard', 'shutdown');
  const shutdownInterval = setInterval(() => {
    if (fs.existsSync(shutdownPath)) {
      fs.unlinkSync(shutdownPath);
      console.log(chalk.yellow('\nShutdown signal received.'));
      worker.stop().then(() => {
        server.close();
        db.close();
        clearInterval(shutdownInterval);
        process.exit(0);
      });
    }
  }, 1000);

  // Signal handlers for graceful shutdown
  const gracefulShutdown = (signal: string): void => {
    console.log(chalk.yellow(`\n${signal} received. Shutting down…`));
    worker.stop().then(() => {
      server.close();
      db.close();
      clearInterval(shutdownInterval);
      process.exit(0);
    });
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

/**
 * Read ~/.agentboard/repos.json and sync registered repos into the projects table.
 * Also cleans up stale projects not in the registry and missing from disk.
 */
function syncProjectsFromRegistry(db: Database.Database): void {
  const registryPath = path.join(os.homedir(), '.agentboard', 'repos.json');

  if (!fs.existsSync(registryPath)) {
    console.log(
      chalk.yellow('No repos registered. Run `agentboard init` in a repo to register it.')
    );
    return;
  }

  // Parse registry
  let registry: RegistryEntry[];
  try {
    const raw = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    if (!Array.isArray(raw)) {
      console.warn(chalk.yellow('Warning: repos.json is not an array, skipping registry sync'));
      return;
    }
    registry = raw as RegistryEntry[];
  } catch (err) {
    console.warn(
      chalk.yellow(`Warning: Failed to parse repos.json: ${err instanceof Error ? err.message : err}`)
    );
    return;
  }

  const registryPaths = new Set<string>();

  // Create project records for registered repos
  for (const entry of registry) {
    if (!entry.path || !entry.name) {
      console.warn(chalk.yellow(`Warning: Skipping registry entry with missing path or name`));
      continue;
    }

    registryPaths.add(entry.path);

    const repoConfigPath = path.join(entry.path, '.agentboard', 'config.json');
    if (!fs.existsSync(repoConfigPath)) {
      console.warn(
        chalk.yellow(`Warning: Registered repo ${entry.name} missing config at ${repoConfigPath}, skipping`)
      );
      continue;
    }

    // Check if project already exists in DB
    const existing = getProjectByPath(db, entry.path);
    if (existing) continue;

    // Create project record
    createProject(db, {
      name: entry.name,
      path: entry.path,
      configPath: repoConfigPath,
    });
    console.log(chalk.green(`Registered project: ${entry.name} (${entry.path})`));
  }

  // Clean up stale projects: not in registry AND config missing from disk
  const allProjects = listProjects(db);
  for (const project of allProjects) {
    if (registryPaths.has(project.path)) continue; // In registry — keep

    const configExists = fs.existsSync(
      path.join(project.path, '.agentboard', 'config.json')
    );
    if (configExists) continue; // Config still on disk — keep (manually created)

    // Both conditions met: not in registry AND config gone — delete
    console.log(
      chalk.yellow(`Removing stale project: ${project.name} (${project.path})`)
    );
    deleteProject(db, project.id);
  }
}
