import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type Database from 'better-sqlite3';
import type { Task, AgentboardConfig } from '../../types/index.js';
import { createRun, updateRun } from '../../db/queries.js';
// Note: we intentionally do NOT import commitChanges from git.ts for format fixes.
// commitFormattingFix below stages only tracked-file modifications (git add -u).

const execFileAsync = promisify(execFile);

export interface CheckResult {
  name: string;
  command: string;
  passed: boolean;
  output: string;
}

export interface ChecksResult {
  passed: boolean;
  results: CheckResult[];
  formattingFixed: boolean;
}

/**
 * Secret patterns to scan for in staged diffs.
 */
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: '.env file', pattern: /^[+].*\.env/m },
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'API key (sk-)', pattern: /sk-[a-zA-Z0-9]{20,}/ },
  { name: 'RSA Private Key', pattern: /BEGIN RSA PRIVATE KEY/ },
  { name: 'EC Private Key', pattern: /BEGIN EC PRIVATE KEY/ },
  { name: 'Private Key (generic)', pattern: /BEGIN PRIVATE KEY/ },
  { name: 'credentials.json', pattern: /credentials\.json/ },
  { name: '.aws/credentials', pattern: /\.aws\/credentials/ },
  { name: 'Generic secret assignment', pattern: /(?:password|secret|token|api_key)\s*[:=]\s*['"][^'"]{8,}['"]/i },
];

/**
 * Run the checks pipeline for a task after implementation.
 *
 * Pipeline order: secrets → test → lint → format → typecheck → security
 * - Secrets are scanned in the staged diff before anything else
 * - For each check, the command from config.commands is run (skipped if null)
 * - If format fails and formatPolicy is 'auto-fix-separate-commit',
 *   the formatFix command is run and changes committed separately
 */
export async function runChecks(
  db: Database.Database,
  task: Task,
  worktreePath: string,
  config: AgentboardConfig
): Promise<ChecksResult> {
  const results: CheckResult[] = [];
  let formattingFixed = false;

  // Create a run record for the checks stage
  const run = createRun(db, {
    taskId: task.id,
    stage: 'checks',
    modelUsed: null,
    input: JSON.stringify({ worktreePath, commands: config.commands }),
  });

  try {
    // ── Secret detection (always runs first) ──────────────────────────
    const secretResult = await scanForSecrets(worktreePath);
    results.push(secretResult);

    if (!secretResult.passed) {
      // Secrets found — fail immediately
      updateRun(db, run.id, {
        status: 'failed',
        output: JSON.stringify(results),
        finishedAt: new Date().toISOString(),
      });

      return { passed: false, results, formattingFixed };
    }

    // ── Run checks in order: test → lint → format → typecheck → security
    const checkOrder: Array<{ name: string; commandKey: keyof AgentboardConfig['commands'] }> = [
      { name: 'test', commandKey: 'test' },
      { name: 'lint', commandKey: 'lint' },
      { name: 'format', commandKey: 'format' },
      { name: 'typecheck', commandKey: 'typecheck' },
      { name: 'security', commandKey: 'security' },
    ];

    let allPassed = true;

    for (const check of checkOrder) {
      const command = config.commands[check.commandKey];
      if (!command) {
        // Skip checks that aren't configured
        continue;
      }

      const checkResult = await runCommand(check.name, command, worktreePath);
      results.push(checkResult);

      if (!checkResult.passed && check.name === 'format') {
        // Handle format auto-fix
        if (
          config.formatPolicy === 'auto-fix-separate-commit' &&
          config.commands.formatFix
        ) {
          // Run the format fix command
          const fixResult = await runCommand(
            'format-fix',
            config.commands.formatFix,
            worktreePath
          );
          results.push(fixResult);

          if (fixResult.passed) {
            // Commit only the formatting changes (tracked files modified by formatter)
            await commitFormattingFix(worktreePath);
            formattingFixed = true;

            // Re-run format check to verify
            const recheck = await runCommand(
              'format-recheck',
              command,
              worktreePath
            );
            results.push(recheck);

            if (recheck.passed) {
              // Format is now fixed — don't count the original failure
              continue;
            }
          }
        }

        // Format failed and wasn't auto-fixed
        allPassed = false;
      } else if (!checkResult.passed) {
        allPassed = false;
      }
    }

    // Update run record
    updateRun(db, run.id, {
      status: allPassed ? 'success' : 'failed',
      output: JSON.stringify(results),
      finishedAt: new Date().toISOString(),
    });

    return { passed: allPassed, results, formattingFixed };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    updateRun(db, run.id, {
      status: 'failed',
      output: errorMessage,
      finishedAt: new Date().toISOString(),
    });

    return {
      passed: false,
      results: [
        ...results,
        {
          name: 'internal-error',
          command: '',
          passed: false,
          output: errorMessage,
        },
      ],
      formattingFixed,
    };
  }
}

/**
 * Run a shell command in the worktree directory and capture output.
 */
async function runCommand(
  name: string,
  command: string,
  cwd: string
): Promise<CheckResult> {
  try {
    const { stdout, stderr } = await execFileAsync('sh', ['-c', command], {
      cwd,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    return {
      name,
      command,
      passed: true,
      output: (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim(),
    };
  } catch (error) {
    // execFile rejects on non-zero exit code
    const err = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
      message?: string;
    };
    const output = [
      err.stdout ?? '',
      err.stderr ? `\n[stderr]\n${err.stderr}` : '',
      err.message ? `\n[error]\n${err.message}` : '',
    ]
      .join('')
      .trim();

    return {
      name,
      command,
      passed: false,
      output: output.slice(0, 5000), // Truncate to keep manageable
    };
  }
}

/**
 * Scan staged changes for potential secrets.
 * Runs `git diff --cached` (or `git diff HEAD` for uncommitted) to get the diff,
 * then checks for secret patterns.
 */
async function scanForSecrets(worktreePath: string): Promise<CheckResult> {
  // Stage all changes so the scan covers implementation changes
  await execFileAsync('git', ['add', '-A'], { cwd: worktreePath });

  // Get the staged diff content
  let diff = '';
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--cached'],
      { cwd: worktreePath, maxBuffer: 10 * 1024 * 1024 }
    );
    diff = stdout;
  } catch {
    diff = '';
  }

  // Get staged file names
  let stagedFiles = '';
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--cached', '--name-only'],
      { cwd: worktreePath }
    );
    stagedFiles = stdout;
  } catch {
    stagedFiles = '';
  }

  const detectedSecrets: string[] = [];

  // Check diff content for secret patterns
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(diff) || pattern.test(stagedFiles)) {
      detectedSecrets.push(name);
    }
  }

  // Check for .env files in changed files
  if (/\.env(?:\.|$)/m.test(stagedFiles)) {
    if (!detectedSecrets.includes('.env file')) {
      detectedSecrets.push('.env file detected in changed files');
    }
  }

  if (detectedSecrets.length > 0) {
    // Unstage so secrets aren't accidentally committed
    await execFileAsync('git', ['reset', 'HEAD'], { cwd: worktreePath }).catch(() => {});

    return {
      name: 'secret-detection',
      command: 'git diff --name-only --cached + pattern matching',
      passed: false,
      output: `Potential secrets detected:\n${detectedSecrets.map((s) => `  - ${s}`).join('\n')}`,
    };
  }

  return {
    name: 'secret-detection',
    command: 'git diff --name-only --cached + pattern matching',
    passed: true,
    output: 'No secrets detected.',
  };
}

/**
 * Stage only modified tracked files and commit formatting changes.
 * Uses `git add -u` (not `git add -A`) so only files already tracked
 * that were modified by the formatter get staged and committed.
 */
async function commitFormattingFix(worktreePath: string): Promise<void> {
  await execFileAsync('git', ['add', '-u'], { cwd: worktreePath });
  await execFileAsync('git', ['commit', '-m', 'style: auto-format', '--allow-empty'], {
    cwd: worktreePath,
  });
}
