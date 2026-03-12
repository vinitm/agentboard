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
      reviewSpec: 'sonnet',
      reviewCode: 'sonnet',
      security: 'haiku',
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

  // 8. Ensure .agentboard/ is in .gitignore
  const gitignorePath = path.join(cwd, '.gitignore');
  const gitignoreEntry = '.agentboard/';
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    if (!content.split('\n').some((line) => line.trim() === gitignoreEntry)) {
      fs.appendFileSync(gitignorePath, `\n${gitignoreEntry}\n`);
      console.log(chalk.green('Added'), gitignoreEntry, 'to .gitignore');
    }
  } else {
    fs.writeFileSync(gitignorePath, `${gitignoreEntry}\n`);
    console.log(chalk.green('Created .gitignore with'), gitignoreEntry);
  }

  // 9. Done
  console.log(
    chalk.green.bold('\nAgentboard initialized successfully!')
  );
}
