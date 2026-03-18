import { describe, it, expect } from 'vitest';
import { parseBlockedReason } from './parse-blocked-reason.js';

describe('parseBlockedReason', () => {
  it('parses severity-tagged spec review issues', () => {
    const reason = '[HIGH] scope: Too broad; [MEDIUM] acceptance: Missing criteria';
    const result = parseBlockedReason(reason);

    expect(result.category).toBe('spec_issues');
    expect(result.categoryLabel).toBe('Spec Issues');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({ severity: 'high', field: 'scope', message: 'Too broad' });
    expect(result.items[1]).toEqual({ severity: 'medium', field: 'acceptance', message: 'Missing criteria' });
  });

  it('parses semicolon-delimited context needs', () => {
    const reason = 'which DB table to use?; what authentication method?';
    const result = parseBlockedReason(reason);

    expect(result.items).toHaveLength(2);
    expect(result.items[0].message).toBe('which DB table to use?');
    expect(result.items[1].message).toBe('what authentication method?');
  });

  it('detects needs_context category', () => {
    const reason = 'Implementation needs additional context';
    const result = parseBlockedReason(reason);

    expect(result.category).toBe('needs_context');
    expect(result.categoryLabel).toBe('Needs Context');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].message).toBe('Implementation needs additional context');
  });

  it('detects checks_failed category', () => {
    const reason = 'Checks failed after inline fix attempt';
    const result = parseBlockedReason(reason);

    expect(result.category).toBe('checks_failed');
    expect(result.categoryLabel).toBe('Checks Failed');
  });

  it('detects quality_failed category', () => {
    const reason = 'Code quality review failed after maximum cycles';
    const result = parseBlockedReason(reason);

    expect(result.category).toBe('quality_failed');
    expect(result.categoryLabel).toBe('Quality Review Failed');
  });

  it('handles simple blocker reason', () => {
    const reason = 'conflicting requirements in spec';
    const result = parseBlockedReason(reason);

    expect(result.category).toBe('implementation_blocked');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].message).toBe('conflicting requirements in spec');
  });

  it('handles unknown category gracefully', () => {
    const reason = 'Something unexpected happened';
    const result = parseBlockedReason(reason);

    expect(result.category).toBe('unknown');
    expect(result.categoryLabel).toBe('Blocked');
    expect(result.items).toHaveLength(1);
  });

  it('handles mixed severity tags', () => {
    const reason = '[CRITICAL] security: SQL injection risk; [LOW] style: Inconsistent naming';
    const result = parseBlockedReason(reason);

    expect(result.items[0].severity).toBe('critical');
    expect(result.items[0].field).toBe('security');
    expect(result.items[1].severity).toBe('low');
    expect(result.items[1].field).toBe('style');
  });

  it('does not produce empty items from trailing semicolons', () => {
    const reason = 'something; ';
    const result = parseBlockedReason(reason);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].message).toBe('something');
  });
});
