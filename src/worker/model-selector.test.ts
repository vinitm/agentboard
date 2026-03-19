import { describe, it, expect } from 'vitest';
import { selectModel } from './model-selector.js';
import { createTestConfig } from '../test/helpers.js';

describe('selectModel', () => {
  const config = createTestConfig();

  it('routes spec_review to the review model (sonnet)', () => {
    expect(selectModel('spec_review', 'low', config)).toBe('sonnet');
  });

  it('routes planning to the planning model (sonnet)', () => {
    expect(selectModel('planning', 'low', config)).toBe('sonnet');
  });

  it('routes implementing to the implementation model (opus)', () => {
    expect(selectModel('implementing', 'low', config)).toBe('opus');
  });

  it('routes code_quality to the review model (sonnet)', () => {
    expect(selectModel('code_quality', 'low', config)).toBe('sonnet');
  });

  it('routes final_review to the review model (sonnet)', () => {
    expect(selectModel('final_review', 'low', config)).toBe('sonnet');
  });

  it('routes pr_creation to the review model (sonnet)', () => {
    expect(selectModel('pr_creation', 'low', config)).toBe('sonnet');
  });

  it('upgrades planning to implementation model for high-risk tasks', () => {
    expect(selectModel('planning', 'high', config)).toBe('opus');
  });

  it('does not upgrade planning for medium-risk tasks', () => {
    expect(selectModel('planning', 'medium', config)).toBe('sonnet');
  });

  it('uses implementation model for implementing regardless of risk', () => {
    expect(selectModel('implementing', 'high', config)).toBe('opus');
    expect(selectModel('implementing', 'medium', config)).toBe('opus');
    expect(selectModel('implementing', 'low', config)).toBe('opus');
  });

  it('respects config overrides', () => {
    const customConfig = createTestConfig({
      modelDefaults: {
        planning: 'haiku',
        implementation: 'sonnet',
        review: 'haiku',
        security: 'sonnet',
        learning: 'haiku',
      },
    });
    expect(selectModel('implementing', 'low', customConfig)).toBe('sonnet');
    expect(selectModel('planning', 'low', customConfig)).toBe('haiku');
    expect(selectModel('code_quality', 'low', customConfig)).toBe('haiku');
  });
});
