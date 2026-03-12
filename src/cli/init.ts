import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { detectLanguages } from '../detect/language.js';
import { detectCommands } from '../detect/commands.js';
import { createDatabase } from '../db/index.js';
import type { AgentboardConfig } from '../types/index.js';

export default async function init(): Promise<void> {
  const cwd = process.cwd();

  // 1. Verify git repo
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    console.error(
      chalk.red('Error: current directory is not a git repository.')
    );
    process.exit(1);
  }

  const abDir = path.join(cwd, '.agentboard');

  // 2. Create .agentboard/ directory
  if (!fs.existsSync(abDir)) {
    fs.mkdirSync(abDir, { recursive: true });
  }

  // 3. Detect languages
  const languages = detectLanguages(cwd);
  console.log(
    chalk.blue('Detected languages:'),
    languages.length > 0 ? languages.join(', ') : 'none'
  );

  // 4. Detect commands
  const commands = detectCommands(cwd, languages);

  // 5. Build default config
  const config: AgentboardConfig = {
    port: 4200,
    host: 'localhost',
    maxConcurrentTasks: 2,
    maxAttemptsPerTask: 3,
    maxReviewCycles: 2,
    maxSubcardDepth: 1,
    prDraft: true,
    autoMerge: false,
    securityMode: 'audit',
    commitPolicy: 'squash',
    formatPolicy: 'auto',
    branchPrefix: 'agentboard/',
    baseBranch: 'main',
    githubRemote: 'origin',
    prMethod: 'gh',
    modelDefaults: {
      planning: 'claude-sonnet-4-20250514',
      implementation: 'claude-sonnet-4-20250514',
      reviewSpec: 'claude-sonnet-4-20250514',
      reviewCode: 'claude-sonnet-4-20250514',
      security: 'claude-sonnet-4-20250514',
    },
    commands,
    notifications: {
      desktop: true,
      terminal: true,
    },
    ruflo: {
      enabled: false,
    },
  };

  // 6. Write config
  const configPath = path.join(abDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(chalk.green('Wrote'), configPath);

  // 7. Create database
  const dbPath = path.join(abDir, 'agentboard.db');
  createDatabase(dbPath);
  console.log(chalk.green('Created database'), dbPath);

  // 8. Done
  console.log(
    chalk.green.bold('\nAgentboard initialized successfully!')
  );
}
