import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadMemory,
  saveMemory,
  recordFailure,
  recordConvention,
  type WorkerMemory,
} from './memory.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-memory-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadMemory', () => {
  it('returns empty memory when file does not exist', () => {
    const mem = loadMemory(tmpDir);
    expect(mem.failurePatterns).toEqual([]);
    expect(mem.conventions).toEqual([]);
  });

  it('returns empty memory when file is corrupt JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'memory.json'), 'not valid json', 'utf-8');
    const mem = loadMemory(tmpDir);
    expect(mem.failurePatterns).toEqual([]);
    expect(mem.conventions).toEqual([]);
  });

  it('returns empty memory when structure is invalid (missing arrays)', () => {
    fs.writeFileSync(path.join(tmpDir, 'memory.json'), JSON.stringify({ foo: 'bar' }), 'utf-8');
    const mem = loadMemory(tmpDir);
    expect(mem.failurePatterns).toEqual([]);
    expect(mem.conventions).toEqual([]);
  });
});

describe('saveMemory + loadMemory round-trip', () => {
  it('preserves failurePatterns and conventions', () => {
    const mem: WorkerMemory = {
      failurePatterns: [{ pattern: 'TypeScript error', resolution: 'fix types', count: 2 }],
      conventions: [{ key: 'indent', value: '2 spaces' }],
      lastUpdated: new Date().toISOString(),
    };
    saveMemory(tmpDir, mem);
    const loaded = loadMemory(tmpDir);
    expect(loaded.failurePatterns).toEqual(mem.failurePatterns);
    expect(loaded.conventions).toEqual(mem.conventions);
  });

  it('creates directory if missing', () => {
    const nestedDir = path.join(tmpDir, 'nested', 'config');
    const mem: WorkerMemory = {
      failurePatterns: [],
      conventions: [],
      lastUpdated: new Date().toISOString(),
    };
    saveMemory(nestedDir, mem);
    expect(fs.existsSync(path.join(nestedDir, 'memory.json'))).toBe(true);
  });
});

describe('recordFailure', () => {
  it('appends new pattern', () => {
    const mem = loadMemory(tmpDir);
    recordFailure(mem, 'lint error', 'fix lint');
    expect(mem.failurePatterns).toHaveLength(1);
    expect(mem.failurePatterns[0]).toEqual({ pattern: 'lint error', resolution: 'fix lint', count: 1 });
  });

  it('increments count for existing pattern and updates resolution', () => {
    const mem = loadMemory(tmpDir);
    recordFailure(mem, 'lint error', 'fix lint v1');
    recordFailure(mem, 'lint error', 'fix lint v2');
    expect(mem.failurePatterns).toHaveLength(1);
    expect(mem.failurePatterns[0].count).toBe(2);
    expect(mem.failurePatterns[0].resolution).toBe('fix lint v2');
  });
});

describe('recordConvention', () => {
  it('appends new convention', () => {
    const mem = loadMemory(tmpDir);
    recordConvention(mem, 'quotes', 'single');
    expect(mem.conventions).toHaveLength(1);
    expect(mem.conventions[0]).toEqual({ key: 'quotes', value: 'single' });
  });

  it('updates existing convention value', () => {
    const mem = loadMemory(tmpDir);
    recordConvention(mem, 'quotes', 'single');
    recordConvention(mem, 'quotes', 'double');
    expect(mem.conventions).toHaveLength(1);
    expect(mem.conventions[0].value).toBe('double');
  });
});
