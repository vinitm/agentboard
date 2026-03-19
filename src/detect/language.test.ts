import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectLanguages } from './language.js';

describe('detectLanguages', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-lang-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects TypeScript when tsconfig.json exists with package.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');

    const languages = detectLanguages(tmpDir);

    expect(languages).toContain('typescript');
    expect(languages).not.toContain('javascript');
  });

  it('detects JavaScript when only package.json exists (no tsconfig)', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');

    const languages = detectLanguages(tmpDir);

    expect(languages).toContain('javascript');
    expect(languages).not.toContain('typescript');
  });

  it('detects Python from requirements.txt', () => {
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'requests\n');

    const languages = detectLanguages(tmpDir);

    expect(languages).toContain('python');
  });

  it('detects Python from pyproject.toml', () => {
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '[tool.poetry]\n');

    const languages = detectLanguages(tmpDir);

    expect(languages).toContain('python');
  });

  it('detects Go from go.mod', () => {
    fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module example.com/myapp\n\ngo 1.21\n');

    const languages = detectLanguages(tmpDir);

    expect(languages).toContain('go');
  });

  it('detects Shell from .sh files', () => {
    fs.writeFileSync(path.join(tmpDir, 'build.sh'), '#!/bin/bash\necho hello\n');

    const languages = detectLanguages(tmpDir);

    expect(languages).toContain('shell');
  });

  it('detects multiple languages simultaneously', () => {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'requests\n');
    fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module example.com/myapp\n\ngo 1.21\n');
    fs.writeFileSync(path.join(tmpDir, 'deploy.sh'), '#!/bin/bash\n');

    const languages = detectLanguages(tmpDir);

    expect(languages).toContain('typescript');
    expect(languages).toContain('python');
    expect(languages).toContain('go');
    expect(languages).toContain('shell');
  });

  it('returns empty array for bare directory', () => {
    const languages = detectLanguages(tmpDir);

    expect(languages).toEqual([]);
  });
});
