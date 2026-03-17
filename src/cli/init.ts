import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { detectLanguages } from '../detect/language.js';
import { detectCommands } from '../detect/commands.js';
import type { AgentboardConfig } from '../types/index.js';
import { ensureGlobalDir, GLOBAL_REGISTRY_PATH } from './paths.js';

interface RegistryEntry {
  path: string;
  name: string;
  registeredAt: string;
}

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
    host: '0.0.0.0',
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
      review: 'sonnet',
      security: 'haiku',
      learning: 'haiku',
    },
    commands,
    notifications: {
      desktop: true,
      terminal: true,
    },
    ruflo: {
      enabled: false,
    },
    maxRalphIterations: 5,
  };

  // 6. Write config
  const configPath = path.join(abDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(chalk.green('Wrote'), configPath);

  // 7. Ensure .agentboard/ is in .gitignore
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

  // 8. Register repo in global registry (~/.agentboard/repos.json)
  registerRepo(cwd);

  // 9. Done
  console.log(
    chalk.green.bold('\nAgentboard initialized successfully!')
  );
}

/**
 * Register the repo at `repoPath` in ~/.agentboard/repos.json.
 * Idempotent — skips if already registered. Uses atomic write to prevent corruption.
 */
function registerRepo(repoPath: string): void {
  ensureGlobalDir();

  // Read existing registry
  let registry: RegistryEntry[] = [];
  if (fs.existsSync(GLOBAL_REGISTRY_PATH)) {
    try {
      registry = JSON.parse(fs.readFileSync(GLOBAL_REGISTRY_PATH, 'utf-8')) as RegistryEntry[];
      if (!Array.isArray(registry)) {
        registry = [];
      }
    } catch {
      // Malformed file — start fresh
      registry = [];
    }
  }

  // Check if already registered (by path)
  if (registry.some((entry) => entry.path === repoPath)) {
    console.log(chalk.blue('Repo already registered in global registry'));
    return;
  }

  // Add entry
  const entry: RegistryEntry = {
    path: repoPath,
    name: path.basename(repoPath),
    registeredAt: new Date().toISOString(),
  };
  registry.push(entry);

  // Atomic write: write to temp file, then rename
  const tmpPath = GLOBAL_REGISTRY_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2) + '\n');
  fs.renameSync(tmpPath, GLOBAL_REGISTRY_PATH);

  console.log(chalk.green('Registered repo in'), GLOBAL_REGISTRY_PATH);
}
