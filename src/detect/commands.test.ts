import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectCommands } from './commands.js';

describe('detectCommands', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-cmds-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writePackageJson(scripts: Record<string, string>) {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts }, null, 2)
    );
  }

  it('extracts test command from package.json scripts → "npm test"', () => {
    writePackageJson({ test: 'vitest run' });

    const cmds = detectCommands(tmpDir, ['typescript']);

    expect(cmds.test).toBe('npm test');
  });

  it('extracts lint script when present → "npm run lint"', () => {
    writePackageJson({ lint: 'eslint .' });

    const cmds = detectCommands(tmpDir, ['typescript']);

    expect(cmds.lint).toBe('npm run lint');
  });

  it('falls back to npx eslint when no lint script', () => {
    writePackageJson({});

    const cmds = detectCommands(tmpDir, ['javascript']);

    expect(cmds.lint).toBe('npx eslint .');
  });

  it('detects typecheck for TypeScript → "npx tsc --noEmit"', () => {
    writePackageJson({});

    const cmds = detectCommands(tmpDir, ['typescript']);

    expect(cmds.typecheck).toBe('npx tsc --noEmit');
  });

  it('does not set typecheck for plain JavaScript', () => {
    writePackageJson({});

    const cmds = detectCommands(tmpDir, ['javascript']);

    expect(cmds.typecheck).toBeNull();
  });

  it('handles Python defaults (pytest, ruff)', () => {
    const cmds = detectCommands(tmpDir, ['python']);

    expect(cmds.test).toBe('pytest -q');
    expect(cmds.lint).toBe('ruff check .');
  });

  it('handles Go defaults (go test, golangci-lint)', () => {
    const cmds = detectCommands(tmpDir, ['go']);

    expect(cmds.test).toBe('go test ./...');
    expect(cmds.lint).toBe('golangci-lint run');
  });

  it('handles missing package.json gracefully', () => {
    // No package.json in tmpDir, but we pass typescript language
    const cmds = detectCommands(tmpDir, ['typescript']);

    // test should be null since there's no package.json with scripts
    expect(cmds.test).toBeNull();
    // typecheck should still be set as it has a non-script fallback
    expect(cmds.typecheck).toBe('npx tsc --noEmit');
    // lint should fall back to npx eslint
    expect(cmds.lint).toBe('npx eslint .');
  });
});
