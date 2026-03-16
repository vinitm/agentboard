import { describe, it, expect } from 'vitest';
import { formatPanelFeedback, parseReviewOutput, type RoleReviewResult } from './review-panel.js';

describe('formatPanelFeedback', () => {
  it('formats mixed pass/fail results with cycle info', () => {
    const results: RoleReviewResult[] = [
      { role: 'architect', passed: false, feedback: 'Bad abstractions', issues: ['God class in foo.ts'] },
      { role: 'qa', passed: true, feedback: 'All criteria met', issues: [] },
      { role: 'security', passed: false, feedback: 'SQL injection found', issues: ['Unparameterized query'] },
    ];
    const output = formatPanelFeedback(results, 2, 3);
    expect(output).toContain('## Review Panel Feedback (Cycle 2/3)');
    expect(output).toContain('### Architect (FAILED)');
    expect(output).toContain('God class in foo.ts');
    expect(output).toContain('### QA Engineer (PASSED)');
    expect(output).toContain('### Security Reviewer (FAILED)');
    expect(output).toContain('Unparameterized query');
  });

  it('formats all-pass results', () => {
    const results: RoleReviewResult[] = [
      { role: 'architect', passed: true, feedback: 'Clean', issues: [] },
      { role: 'qa', passed: true, feedback: 'Good', issues: [] },
      { role: 'security', passed: true, feedback: 'Secure', issues: [] },
    ];
    const output = formatPanelFeedback(results, 1, 3);
    expect(output).toContain('### Architect (PASSED)');
    expect(output).toContain('### QA Engineer (PASSED)');
    expect(output).toContain('### Security Reviewer (PASSED)');
    expect(output).not.toContain('FAILED');
  });
});

describe('parseReviewOutput', () => {
  it('parses JSON from code fences', () => {
    const output = '```json\n{"passed": true, "feedback": "All good", "issues": []}\n```';
    const result = parseReviewOutput(output);
    expect(result.passed).toBe(true);
    expect(result.feedback).toBe('All good');
    expect(result.issues).toEqual([]);
  });

  it('parses raw JSON with passed key', () => {
    const output = 'Some text before {"passed": false, "feedback": "Bad", "issues": ["bug"]} after';
    const result = parseReviewOutput(output);
    expect(result.passed).toBe(false);
    expect(result.issues).toEqual(['bug']);
  });

  it('returns failed result for unparseable output', () => {
    const result = parseReviewOutput('This is just plain text with no JSON');
    expect(result.passed).toBe(false);
    expect(result.issues).toContain('Could not parse structured review output');
  });

  it('handles missing fields gracefully', () => {
    const output = '```json\n{"passed": true}\n```';
    const result = parseReviewOutput(output);
    expect(result.passed).toBe(true);
    expect(result.feedback).toBe('');
    expect(result.issues).toEqual([]);
  });

  it('filters non-string issues', () => {
    const output = '```json\n{"passed": false, "feedback": "x", "issues": ["real", 123, null]}\n```';
    const result = parseReviewOutput(output);
    expect(result.issues).toEqual(['real']);
  });
});
