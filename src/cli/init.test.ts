import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTestRepo } from '../test/helpers.js';
import { detectLanguages } from '../detect/language.js';
import { detectCommands } from '../detect/commands.js';

describe('init: language detection in a temp git repo', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('detects TypeScript when tsconfig.json and package.json are present', async () => {
    const repo = await createTestRepo();
    cleanup = repo.cleanup;

    fs.writeFileSync(path.join(repo.repoPath, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(repo.repoPath, 'package.json'), JSON.stringify({ name: 'test' }));

    const languages = detectLanguages(repo.repoPath);

    expect(languages).toContain('typescript');
    expect(languages).not.toContain('javascript');
  });

  it('detects JavaScript when only package.json is present', async () => {
    const repo = await createTestRepo();
    cleanup = repo.cleanup;

    fs.writeFileSync(path.join(repo.repoPath, 'package.json'), JSON.stringify({ name: 'test' }));

    const languages = detectLanguages(repo.repoPath);

    expect(languages).toContain('javascript');
    expect(languages).not.toContain('typescript');
  });

  it('detects Python from requirements.txt', async () => {
    const repo = await createTestRepo();
    cleanup = repo.cleanup;

    fs.writeFileSync(path.join(repo.repoPath, 'requirements.txt'), 'requests\n');

    const languages = detectLanguages(repo.repoPath);

    expect(languages).toContain('python');
  });

  it('returns empty array when no language markers exist', async () => {
    const repo = await createTestRepo();
    cleanup = repo.cleanup;

    const languages = detectLanguages(repo.repoPath);

    expect(languages).toEqual([]);
  });
});

describe('init: command detection in a temp git repo', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('detects npm test command when package.json has a test script', async () => {
    const repo = await createTestRepo();
    cleanup = repo.cleanup;

    fs.writeFileSync(
      path.join(repo.repoPath, 'package.json'),
      JSON.stringify({ name: 'test', scripts: { test: 'vitest run' } })
    );
    fs.writeFileSync(path.join(repo.repoPath, 'tsconfig.json'), '{}');

    const languages = detectLanguages(repo.repoPath);
    const commands = detectCommands(repo.repoPath, languages);

    expect(commands.test).toBe('npm test');
  });

  it('detects typecheck command for TypeScript projects', async () => {
    const repo = await createTestRepo();
    cleanup = repo.cleanup;

    fs.writeFileSync(
      path.join(repo.repoPath, 'package.json'),
      JSON.stringify({ name: 'test', scripts: {} })
    );
    fs.writeFileSync(path.join(repo.repoPath, 'tsconfig.json'), '{}');

    const languages = detectLanguages(repo.repoPath);
    const commands = detectCommands(repo.repoPath, languages);

    expect(commands.typecheck).toBe('npx tsc --noEmit');
  });

  it('sets typecheck to null for non-TypeScript projects', async () => {
    const repo = await createTestRepo();
    cleanup = repo.cleanup;

    fs.writeFileSync(
      path.join(repo.repoPath, 'package.json'),
      JSON.stringify({ name: 'test', scripts: {} })
    );

    const languages = detectLanguages(repo.repoPath);
    const commands = detectCommands(repo.repoPath, languages);

    expect(commands.typecheck).toBeNull();
  });

  it('falls back to pytest for Python projects with no test script', async () => {
    const repo = await createTestRepo();
    cleanup = repo.cleanup;

    fs.writeFileSync(path.join(repo.repoPath, 'requirements.txt'), 'pytest\n');

    const languages = detectLanguages(repo.repoPath);
    const commands = detectCommands(repo.repoPath, languages);

    expect(commands.test).toBe('pytest -q');
  });
});

describe('init: .agentboard directory creation', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('can create .agentboard directory inside a git repo', async () => {
    const repo = await createTestRepo();
    cleanup = repo.cleanup;

    const abDir = path.join(repo.repoPath, '.agentboard');
    fs.mkdirSync(abDir, { recursive: true });

    expect(fs.existsSync(abDir)).toBe(true);
  });

  it('can write config.json inside .agentboard directory', async () => {
    const repo = await createTestRepo();
    cleanup = repo.cleanup;

    const abDir = path.join(repo.repoPath, '.agentboard');
    fs.mkdirSync(abDir, { recursive: true });

    const configPath = path.join(abDir, 'config.json');
    const config = { port: 4200, host: '0.0.0.0' };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    expect(fs.existsSync(configPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { port: number; host: string };
    expect(written.port).toBe(4200);
    expect(written.host).toBe('0.0.0.0');
  });

  it('the temp repo has a .git directory (is a real git repo)', async () => {
    const repo = await createTestRepo();
    cleanup = repo.cleanup;

    expect(fs.existsSync(path.join(repo.repoPath, '.git'))).toBe(true);
  });
});
