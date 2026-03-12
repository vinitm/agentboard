import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { createDatabase } from '../db/index.js';
import { createServer } from '../server/index.js';
import type { AgentboardConfig } from '../types/index.js';

export default async function up(opts: {
  port?: string;
}): Promise<void> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, '.agentboard', 'config.json');

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

  // 3. Start server
  const server = createServer(db, config);

  // 4. Watch for shutdown file
  const shutdownPath = path.join(cwd, '.agentboard', 'shutdown');
  const shutdownInterval = setInterval(() => {
    if (fs.existsSync(shutdownPath)) {
      fs.unlinkSync(shutdownPath);
      console.log(chalk.yellow('\nShutdown signal received.'));
      server.close();
      db.close();
      clearInterval(shutdownInterval);
      process.exit(0);
    }
  }, 1000);

  console.log(
    chalk.green.bold(
      `Agentboard running at http://${config.host}:${config.port}`
    )
  );
}
