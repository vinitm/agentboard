import { describe, it, expect } from 'vitest';
import type { FinalReviewResult } from '../../types/index.js';
import { parseFinalReviewOutput } from './final-review.js';

describe('runFinalReview', () => {
  it('exports runFinalReview function', async () => {
    const mod = await import('./final-review.js');
    expect(typeof mod.runFinalReview).toBe('function');
  });
});

describe('FinalReviewResult type', () => {
  it('can express full spec compliance', () => {
    const result: FinalReviewResult = {
      passed: true,
      specCompliance: {
        criterionMet: {
          'Users can log in': true,
          'Users can log out': true,
        },
        missingRequirements: [],
      },
      integrationIssues: [],
      summary: 'All acceptance criteria met.',
    };
    expect(result.passed).toBe(true);
    expect(result.specCompliance.criterionMet['Users can log in']).toBe(true);
    expect(result.specCompliance.missingRequirements).toHaveLength(0);
    expect(result.integrationIssues).toHaveLength(0);
  });

  it('can express partial compliance with issues', () => {
    const result: FinalReviewResult = {
      passed: false,
      specCompliance: {
        criterionMet: {
          'Users can log in': true,
          'Error messages are user-friendly': false,
        },
        missingRequirements: ['No validation on password strength'],
      },
      integrationIssues: ['Auth module not wired to user profile page'],
      summary: 'Missing requirements and integration issues found.',
    };
    expect(result.passed).toBe(false);
    expect(result.specCompliance.missingRequirements).toHaveLength(1);
    expect(result.integrationIssues).toHaveLength(1);
  });
});

describe('parseFinalReviewOutput', () => {
  it('parses JSON from code fences', () => {
    const output = `Some preamble text
\`\`\`json
{
  "passed": true,
  "specCompliance": {
    "criterionMet": {"criterion A": true},
    "missingRequirements": []
  },
  "integrationIssues": [],
  "summary": "All good"
}
\`\`\``;
    const result = parseFinalReviewOutput(output);
    expect(result.passed).toBe(true);
    expect(result.specCompliance.criterionMet['criterion A']).toBe(true);
    expect(result.summary).toBe('All good');
  });

  it('parses raw JSON with passed key', () => {
    const output = 'Before {"passed": false, "specCompliance": {"criterionMet": {}, "missingRequirements": ["missing X"]}, "integrationIssues": ["issue Y"], "summary": "Bad"} after';
    const result = parseFinalReviewOutput(output);
    expect(result.passed).toBe(false);
    expect(result.specCompliance.missingRequirements).toEqual(['missing X']);
    expect(result.integrationIssues).toEqual(['issue Y']);
  });

  it('returns failed result for unparseable output', () => {
    const result = parseFinalReviewOutput('This is just plain text with no JSON');
    expect(result.passed).toBe(false);
    expect(result.integrationIssues).toContain('Could not parse final review output');
    expect(result.summary).toBeTruthy();
  });

  it('handles missing fields gracefully', () => {
    const output = '```json\n{"passed": true}\n```';
    const result = parseFinalReviewOutput(output);
    expect(result.passed).toBe(true);
    expect(result.specCompliance.criterionMet).toEqual({});
    expect(result.specCompliance.missingRequirements).toEqual([]);
    expect(result.integrationIssues).toEqual([]);
    expect(result.summary).toBe('');
  });

  it('filters non-string values from arrays', () => {
    const output = '```json\n{"passed": false, "specCompliance": {"criterionMet": {}, "missingRequirements": ["real", 123, null]}, "integrationIssues": ["valid", 42], "summary": "test"}\n```';
    const result = parseFinalReviewOutput(output);
    expect(result.specCompliance.missingRequirements).toEqual(['real']);
    expect(result.integrationIssues).toEqual(['valid']);
  });

  it('filters non-boolean values from criterionMet', () => {
    const output = '```json\n{"passed": true, "specCompliance": {"criterionMet": {"a": true, "b": "yes", "c": false}, "missingRequirements": []}, "integrationIssues": [], "summary": "ok"}\n```';
    const result = parseFinalReviewOutput(output);
    expect(result.specCompliance.criterionMet).toEqual({ a: true, c: false });
  });
});

describe('final-review prompt template', () => {
  it('exists on disk', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const templatePath = path.resolve(__dirname, '../../../prompts/final-review.md');
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  it('contains required interpolation variables', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const templatePath = path.resolve(__dirname, '../../../prompts/final-review.md');
    const content = fs.readFileSync(templatePath, 'utf-8');
    expect(content).toContain('{diff}');
    expect(content).toContain('{spec}');
    expect(content).toContain('{acceptanceCriteria}');
  });

  it('instructs JSON output format', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const templatePath = path.resolve(__dirname, '../../../prompts/final-review.md');
    const content = fs.readFileSync(templatePath, 'utf-8');
    expect(content).toContain('"passed"');
    expect(content).toContain('"specCompliance"');
    expect(content).toContain('"integrationIssues"');
  });
});
