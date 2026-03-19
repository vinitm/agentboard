import fs from 'node:fs';
import chalk from 'chalk';
import { ensureGlobalDir, GLOBAL_SHUTDOWN_PATH } from './paths.js';

export default async function down(): Promise<void> {
  ensureGlobalDir();

  // Write a shutdown file as a simple IPC mechanism
  try {
    fs.writeFileSync(GLOBAL_SHUTDOWN_PATH, String(Date.now()));
    console.log(chalk.yellow('Shutdown signal sent.'));
  } catch {
    console.error(
      chalk.red(
        'Error: could not write shutdown signal. Is ~/.agentboard/ accessible?'
      )
    );
    process.exit(1);
  }
}
