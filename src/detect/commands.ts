import fs from 'node:fs';
import path from 'node:path';
import type { Commands } from '../types/index.js';

/**
 * Read package.json scripts (if any) and return the scripts object.
 */
function readPackageScripts(
  repoPath: string
): Record<string, string> | null {
  const pkgPath = path.join(repoPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    return pkg.scripts ?? {};
  } catch {
    return null;
  }
}

function hasScript(
  scripts: Record<string, string> | null,
  name: string
): boolean {
  return scripts !== null && name in scripts;
}

/**
 * Auto-detect check commands for the repo based on detected languages.
 */
export function detectCommands(
  repoPath: string,
  languages: string[]
): Commands {
  const cmds: Commands = {
    test: null,
    lint: null,
    format: null,
    formatFix: null,
    typecheck: null,
    security: null,
  };

  const isTS = languages.includes('typescript');
  const isJS = languages.includes('javascript');

  if (isTS || isJS) {
    const scripts = readPackageScripts(repoPath);

    // Test
    cmds.test = hasScript(scripts, 'test') ? 'npm test' : null;

    // Lint
    cmds.lint = hasScript(scripts, 'lint')
      ? 'npm run lint'
      : 'npx eslint .';

    // Format check
    cmds.format = hasScript(scripts, 'format:check')
      ? 'npm run format:check'
      : 'npx prettier -c .';

    // Format fix
    cmds.formatFix = hasScript(scripts, 'format')
      ? 'npm run format'
      : 'npx prettier -w .';

    // Typecheck
    cmds.typecheck = hasScript(scripts, 'typecheck')
      ? 'npm run typecheck'
      : 'npx tsc --noEmit';

    // Security
    cmds.security = hasScript(scripts, 'audit')
      ? 'npm audit --json'
      : null;
  }

  if (languages.includes('python')) {
    cmds.test = cmds.test ?? 'pytest -q';
    cmds.lint = cmds.lint ?? 'ruff check .';
    cmds.format = cmds.format ?? 'ruff format --check .';
    cmds.formatFix = cmds.formatFix ?? 'ruff format .';
    cmds.security = cmds.security ?? 'pip-audit';
  }

  if (languages.includes('go')) {
    cmds.test = cmds.test ?? 'go test ./...';
    cmds.lint = cmds.lint ?? 'golangci-lint run';
    cmds.formatFix = cmds.formatFix ?? 'gofmt -w .';
    cmds.security = cmds.security ?? 'gosec ./...';
  }

  return cmds;
}
