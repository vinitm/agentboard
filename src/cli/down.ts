import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';

export default async function down(): Promise<void> {
  const cwd = process.cwd();
  const shutdownPath = path.join(cwd, '.agentboard', 'shutdown');

  // Write a shutdown file as a simple IPC mechanism
  try {
    fs.writeFileSync(shutdownPath, String(Date.now()));
    console.log(chalk.yellow('Shutdown signal sent.'));
  } catch {
    console.error(
      chalk.red(
        'Error: could not write shutdown signal. Is agentboard initialized?'
      )
    );
    process.exit(1);
  }
}
