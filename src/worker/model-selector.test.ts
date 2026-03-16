import { describe, it, expect } from 'vitest';
import { selectModel } from './model-selector.js';
import { createTestConfig } from '../test/helpers.js';

describe('selectModel', () => {
  const config = createTestConfig();

  it('planning → config.modelDefaults.planning (sonnet)', () => {
    expect(selectModel('planning', 'low', config)).toBe('sonnet');
  });

  it('implementing → config.modelDefaults.implementation (opus)', () => {
    expect(selectModel('implementing', 'low', config)).toBe('opus');
  });

  it('checks → config.modelDefaults.implementation (opus)', () => {
    expect(selectModel('checks', 'low', config)).toBe('opus');
  });

  it('review_spec → config.modelDefaults.reviewSpec (sonnet)', () => {
    expect(selectModel('review_spec', 'low', config)).toBe('sonnet');
  });

  it('review_code → config.modelDefaults.reviewCode (sonnet)', () => {
    expect(selectModel('review_code', 'low', config)).toBe('sonnet');
  });

  it('pr_creation → config.modelDefaults.implementation (opus)', () => {
    expect(selectModel('pr_creation', 'low', config)).toBe('opus');
  });

  it('high risk overrides review_spec → opus', () => {
    expect(selectModel('review_spec', 'high', config)).toBe('opus');
  });

  it('high risk overrides review_code → opus', () => {
    expect(selectModel('review_code', 'high', config)).toBe('opus');
  });

  it('high risk does NOT override planning', () => {
    expect(selectModel('planning', 'high', config)).toBe('sonnet');
  });

  it('medium risk does NOT override review_spec', () => {
    expect(selectModel('review_spec', 'medium', config)).toBe('sonnet');
  });

  it('medium risk does NOT override review_code', () => {
    expect(selectModel('review_code', 'medium', config)).toBe('sonnet');
  });
});
