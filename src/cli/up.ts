import fs from 'node:fs';
import chalk from 'chalk';
import { createDatabase } from '../db/index.js';
import { createServer } from '../server/index.js';
import { createWorkerLoop } from '../worker/loop.js';
import { recoverStaleTasks } from '../worker/recovery.js';
import { getProjectByPath, createProject, listProjects, deleteProject } from '../db/queries.js';
import type { AgentboardConfig } from '../types/index.js';
import type Database from 'better-sqlite3';
import {
  ensureGlobalDir,
  loadServerConfig,
  GLOBAL_DB_PATH,
  GLOBAL_SHUTDOWN_PATH,
  GLOBAL_REGISTRY_PATH,
  GLOBAL_SERVER_CONFIG_PATH,
} from './paths.js';

interface RegistryEntry {
  path: string;
  name: string;
  registeredAt: string;
}

export default async function up(opts: {
  port?: string;
}): Promise<void> {
  // Ensure ~/.agentboard/ exists
  ensureGlobalDir();

  // Clean up stale shutdown file from a previous crash
  if (fs.existsSync(GLOBAL_SHUTDOWN_PATH)) {
    fs.unlinkSync(GLOBAL_SHUTDOWN_PATH);
  }

  // 1. Load server config from ~/.agentboard/server.json
  const serverConfig = loadServerConfig();

  // Override port from CLI flag
  if (opts.port) {
    serverConfig.port = parseInt(opts.port, 10);
  }

  // Build a full AgentboardConfig with server-level values for the worker/server.
  // Per-project settings are loaded from each project's .agentboard/config.json
  // at task processing time.
  const config: AgentboardConfig = {
    port: serverConfig.port,
    host: serverConfig.host,
    maxConcurrentTasks: serverConfig.maxConcurrentTasks,
    maxAttemptsPerTask: 10,
    maxReviewCycles: 3,
    maxSubcardDepth: 2,
    prDraft: true,
    autoMerge: false,
    securityMode: 'lightweight',
    commitPolicy: 'after-checks-pass',
    formatPolicy: 'auto-fix-separate-commit',
    branchPrefix: 'agent/',
    baseBranch: 'main',
    githubRemote: 'origin',
    prMethod: 'gh-cli',
    modelDefaults: {
      planning: 'sonnet',
      implementation: 'opus',
      review: 'sonnet',
      security: 'haiku',
    },
    commands: {
      test: null,
      lint: null,
      format: null,
      formatFix: null,
      typecheck: null,
      security: null,
    },
    notifications: serverConfig.notifications,
    ruflo: { enabled: false },
    maxRalphIterations: 5,
  };

  // 2. Open database at ~/.agentboard/agentboard.db
  const db = createDatabase(GLOBAL_DB_PATH);

  // 3. Sync projects from global registry
  syncProjectsFromRegistry(db);

  // 4. Start server
  const { server, io } = createServer(db, config, { configPath: GLOBAL_SERVER_CONFIG_PATH });

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

  // Show registered projects
  const projects = listProjects(db);
  if (projects.length > 0) {
    console.log(chalk.blue(`Serving ${projects.length} project(s):`));
    for (const project of projects) {
      console.log(chalk.blue(`  • ${project.name} (${project.path})`));
    }
  } else {
    console.log(
      chalk.yellow('No projects registered. Run `agentboard init` in a repo to register it.')
    );
  }

  // 5. Crash recovery: recover stale tasks
  const recovered = recoverStaleTasks(db);
  if (recovered > 0) {
    console.log(chalk.yellow(`Recovered ${recovered} stale task(s) from previous crash`));
  }

  // 6. Start worker loop
  const worker = createWorkerLoop(db, config, io);
  worker.start();

  // 7. Watch for shutdown file at ~/.agentboard/shutdown
  const shutdownInterval = setInterval(() => {
    if (fs.existsSync(GLOBAL_SHUTDOWN_PATH)) {
      fs.unlinkSync(GLOBAL_SHUTDOWN_PATH);
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
  if (!fs.existsSync(GLOBAL_REGISTRY_PATH)) {
    return;
  }

  // Parse registry
  let registry: RegistryEntry[];
  try {
    const raw = JSON.parse(fs.readFileSync(GLOBAL_REGISTRY_PATH, 'utf-8'));
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

    const repoConfigPath = `${entry.path}/.agentboard/config.json`;
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
      `${project.path}/.agentboard/config.json`
    );
    if (configExists) continue; // Config still on disk — keep (manually created)

    // Both conditions met: not in registry AND config gone — delete
    console.log(
      chalk.yellow(`Removing stale project: ${project.name} (${project.path})`)
    );
    deleteProject(db, project.id);
  }
}
