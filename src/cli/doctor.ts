import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const esmRequire = createRequire(import.meta.url);
import chalk from 'chalk';
import {
  GLOBAL_DIR,
  GLOBAL_DB_PATH,
  GLOBAL_REGISTRY_PATH,
  GLOBAL_SERVER_CONFIG_PATH,
} from './paths.js';

interface Check {
  label: string;
  critical: boolean;
  test: () => boolean;
}

function commandExists(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export default async function doctor(): Promise<void> {
  const cwd = process.cwd();
  let failures = 0;
  let criticalFailures = 0;

  const checks: Check[] = [
    // ── Prerequisites ──────────────────────────────────────────────────
    {
      label: 'git is installed',
      critical: true,
      test: () => commandExists('git --version'),
    },
    {
      label: 'gh CLI is installed',
      critical: false,
      test: () => commandExists('gh --version'),
    },
    {
      label: 'node is installed',
      critical: true,
      test: () => commandExists('node --version'),
    },
    {
      label: 'claude CLI is installed',
      critical: false,
      test: () => commandExists('claude --version'),
    },
    {
      label: 'node-pty is installed (required for PTY terminal mode)',
      critical: false,
      test: () => {
        try {
          esmRequire('node-pty');
          return true;
        } catch {
          return false;
        }
      },
    },

    // ── Global state (~/.agentboard/) ──────────────────────────────────
    {
      label: '~/.agentboard/ directory exists',
      critical: false,
      test: () => fs.existsSync(GLOBAL_DIR),
    },
    {
      label: '~/.agentboard/server.json exists',
      critical: false,
      test: () => fs.existsSync(GLOBAL_SERVER_CONFIG_PATH),
    },
    {
      label: '~/.agentboard/repos.json exists',
      critical: false,
      test: () => fs.existsSync(GLOBAL_REGISTRY_PATH),
    },
    {
      label: '~/.agentboard/agentboard.db exists',
      critical: false,
      test: () => fs.existsSync(GLOBAL_DB_PATH),
    },

    // ── Local project (optional — only relevant if run from a repo) ───
    {
      label: 'Current directory is a git repo',
      critical: false,
      test: () => fs.existsSync(path.join(cwd, '.git')),
    },
    {
      label: '.agentboard/config.json exists (current project)',
      critical: false,
      test: () =>
        fs.existsSync(path.join(cwd, '.agentboard', 'config.json')),
    },
  ];

  console.log(chalk.bold('Agentboard Doctor\n'));

  for (const check of checks) {
    const ok = check.test();
    const icon = ok ? chalk.green('\u2713') : chalk.red('\u2717');
    const suffix =
      !ok && !check.critical ? chalk.yellow(' (warning)') : '';
    console.log(`  ${icon} ${check.label}${suffix}`);

    if (!ok) {
      failures++;
      if (check.critical) criticalFailures++;
    }
  }

  // Check for orphaned agentboard/* branches
  if (fs.existsSync(path.join(cwd, '.git'))) {
    try {
      const { listOrphanedBranches } = await import('./prune.js');
      const orphaned = await listOrphanedBranches(cwd);
      if (orphaned.length > 0) {
        console.log(chalk.yellow(`\n  ⚠ ${orphaned.length} orphaned agentboard/* branch(es) found:`));
        for (const b of orphaned.slice(0, 5)) {
          console.log(chalk.dim(`    • ${b}`));
        }
        if (orphaned.length > 5) {
          console.log(chalk.dim(`    … and ${orphaned.length - 5} more`));
        }
        console.log(chalk.dim('    Run: agentboard prune --dry-run'));
        failures++;
      }
    } catch {
      // DB not available or git error — skip silently
    }
  }

  // Show registered projects
  if (fs.existsSync(GLOBAL_REGISTRY_PATH)) {
    try {
      const registry = JSON.parse(fs.readFileSync(GLOBAL_REGISTRY_PATH, 'utf-8'));
      if (Array.isArray(registry) && registry.length > 0) {
        console.log(chalk.bold('\nRegistered projects:'));
        for (const entry of registry) {
          const configExists = fs.existsSync(
            path.join(entry.path, '.agentboard', 'config.json')
          );
          const icon = configExists ? chalk.green('\u2713') : chalk.red('\u2717');
          console.log(`  ${icon} ${entry.name} (${entry.path})`);
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  console.log('');

  if (criticalFailures > 0) {
    console.log(
      chalk.red.bold(
        `${criticalFailures} critical check(s) failed.`
      )
    );
    process.exit(1);
  } else if (failures > 0) {
    console.log(
      chalk.yellow(
        `All critical checks passed. ${failures} warning(s).`
      )
    );
  } else {
    console.log(chalk.green.bold('All checks passed!'));
  }
}
