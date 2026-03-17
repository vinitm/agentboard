import { describe, it, expect } from 'vitest';
import { selectModel } from './model-selector.js';
import { createTestConfig } from '../test/helpers.js';

describe('selectModel', () => {
  const config = createTestConfig();

  it('returns opus for all stages', () => {
    expect(selectModel('planning', 'low', config)).toBe('opus');
    expect(selectModel('implementing', 'low', config)).toBe('opus');
    expect(selectModel('checks', 'low', config)).toBe('opus');
    expect(selectModel('code_quality', 'low', config)).toBe('opus');
    expect(selectModel('final_review', 'low', config)).toBe('opus');
    expect(selectModel('pr_creation', 'low', config)).toBe('opus');
    expect(selectModel('spec_review', 'low', config)).toBe('opus');
  });

  it('returns opus regardless of risk level', () => {
    expect(selectModel('planning', 'high', config)).toBe('opus');
    expect(selectModel('implementing', 'medium', config)).toBe('opus');
  });
});
