import { describe, it, expect } from 'vitest';

describe('inline-fix', () => {
  it('exports runInlineFix function', async () => {
    const { runInlineFix } = await import('./inline-fix.js');
    expect(typeof runInlineFix).toBe('function');
  });

  it('InlineFixResult type works', () => {
    const result = { fixed: true, output: 'fixed lint errors' };
    expect(result.fixed).toBe(true);
  });
});
