import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('doctor prerequisites', () => {
  it('git is available', () => {
    expect(() => execSync('which git', { stdio: 'ignore' })).not.toThrow();
  });

  it('node is available', () => {
    expect(() => execSync('which node', { stdio: 'ignore' })).not.toThrow();
  });
});
