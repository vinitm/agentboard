import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';

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
      label: 'Current directory is a git repo',
      critical: true,
      test: () => fs.existsSync(path.join(cwd, '.git')),
    },
    {
      label: '.agentboard/ directory exists',
      critical: true,
      test: () => fs.existsSync(path.join(cwd, '.agentboard')),
    },
    {
      label: '.agentboard/config.json exists',
      critical: true,
      test: () =>
        fs.existsSync(path.join(cwd, '.agentboard', 'config.json')),
    },
    {
      label: '.agentboard/agentboard.db exists',
      critical: true,
      test: () =>
        fs.existsSync(path.join(cwd, '.agentboard', 'agentboard.db')),
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
