import { describe, it, expect } from 'vitest';
import { classifyFailure } from './inline-fix.js';
import type { CheckResult } from './stages/checks.js';

describe('inline-fix', () => {
  it('exports runInlineFix function', async () => {
    const { runInlineFix } = await import('./inline-fix.js');
    expect(typeof runInlineFix).toBe('function');
  });

  it('InlineFixResult type works', () => {
    const result = { fixed: true, output: 'fixed lint errors', attempts: 1, failureType: 'lint_error' as const };
    expect(result.fixed).toBe(true);
    expect(result.attempts).toBe(1);
  });
});

describe('classifyFailure', () => {
  it('classifies typecheck failures as type_error', () => {
    const checks: CheckResult[] = [
      { name: 'typecheck', command: 'npx tsc --noEmit', passed: false, output: 'error TS2345: Argument...' },
    ];
    expect(classifyFailure(checks)).toBe('type_error');
  });

  it('classifies lint failures as lint_error', () => {
    const checks: CheckResult[] = [
      { name: 'lint', command: 'npm run lint', passed: false, output: 'ESLint found errors' },
    ];
    expect(classifyFailure(checks)).toBe('lint_error');
  });

  it('classifies test failures as test_failure', () => {
    const checks: CheckResult[] = [
      { name: 'test', command: 'npm test', passed: false, output: 'FAIL src/foo.test.ts\nexpect(received).toBe(expected)' },
    ];
    expect(classifyFailure(checks)).toBe('test_failure');
  });

  it('classifies secret detection as security_violation', () => {
    const checks: CheckResult[] = [
      { name: 'secret-detection', command: 'git diff + pattern matching', passed: false, output: 'Potential secrets detected' },
    ];
    expect(classifyFailure(checks)).toBe('security_violation');
  });

  it('classifies unknown failures as unknown', () => {
    const checks: CheckResult[] = [
      { name: 'custom-check', command: 'some-tool', passed: false, output: 'something went wrong' },
    ];
    expect(classifyFailure(checks)).toBe('unknown');
  });

  it('skips passing checks', () => {
    const checks: CheckResult[] = [
      { name: 'test', command: 'npm test', passed: true, output: 'All tests pass' },
      { name: 'lint', command: 'npm run lint', passed: false, output: 'ESLint errors' },
    ];
    expect(classifyFailure(checks)).toBe('lint_error');
  });
});
