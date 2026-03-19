import { describe, it, expect } from 'vitest';
import type { ImplementationResult, ImplementerStatus } from '../../types/index.js';
import { parseStructuredOutput } from './implementer.js';

describe('implementer v2 types', () => {
  it('ImplementationResult supports all statuses', () => {
    const results: ImplementationResult[] = [
      { status: 'DONE', output: 'ok' },
      { status: 'DONE_WITH_CONCERNS', output: 'ok', concerns: ['file growing large'] },
      { status: 'NEEDS_CONTEXT', output: '', contextNeeded: ['what DB schema to use?'] },
      { status: 'BLOCKED', output: '', blockerReason: 'conflicting requirements' },
    ];
    expect(results).toHaveLength(4);
    expect(results.every(r => r.output !== undefined)).toBe(true);
  });

  it('each status is a valid ImplementerStatus', () => {
    const statuses: ImplementerStatus[] = ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'];
    expect(statuses).toHaveLength(4);
  });
});

describe('parseStructuredOutput', () => {
  it('parses a DONE status from fenced JSON block', () => {
    const output = `I implemented the feature.\n\n\`\`\`json\n{\n  "status": "DONE",\n  "concerns": [],\n  "contextNeeded": [],\n  "blockerReason": null\n}\n\`\`\``;
    const result = parseStructuredOutput(output);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('DONE');
    expect(result!.output).toBe(output);
  });

  it('parses DONE_WITH_CONCERNS with concerns array', () => {
    const output = `Done but worried.\n\n\`\`\`json\n{\n  "status": "DONE_WITH_CONCERNS",\n  "concerns": ["file is 900 lines", "no edge case tests"]\n}\n\`\`\``;
    const result = parseStructuredOutput(output);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('DONE_WITH_CONCERNS');
    expect(result!.concerns).toEqual(['file is 900 lines', 'no edge case tests']);
  });

  it('parses NEEDS_CONTEXT with contextNeeded array', () => {
    const output = `Need more info.\n\n\`\`\`json\n{\n  "status": "NEEDS_CONTEXT",\n  "contextNeeded": ["which DB table to use?"]\n}\n\`\`\``;
    const result = parseStructuredOutput(output);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('NEEDS_CONTEXT');
    expect(result!.contextNeeded).toEqual(['which DB table to use?']);
  });

  it('parses BLOCKED with blockerReason', () => {
    const output = `Cannot proceed.\n\n\`\`\`json\n{\n  "status": "BLOCKED",\n  "blockerReason": "conflicting requirements in spec"\n}\n\`\`\``;
    const result = parseStructuredOutput(output);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('BLOCKED');
    expect(result!.blockerReason).toBe('conflicting requirements in spec');
  });

  it('returns null when no JSON block is present', () => {
    const output = 'Just some plain text output with no JSON.';
    const result = parseStructuredOutput(output);
    expect(result).toBeNull();
  });

  it('returns null when JSON block has invalid status', () => {
    const output = `\`\`\`json\n{\n  "status": "INVALID_STATUS"\n}\n\`\`\``;
    const result = parseStructuredOutput(output);
    expect(result).toBeNull();
  });

  it('returns null when JSON is malformed', () => {
    const output = `\`\`\`json\n{ "status": "DONE", broken }\n\`\`\``;
    const result = parseStructuredOutput(output);
    expect(result).toBeNull();
  });

  it('parses JSON block without json language tag', () => {
    const output = `Done.\n\n\`\`\`\n{\n  "status": "DONE"\n}\n\`\`\``;
    const result = parseStructuredOutput(output);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('DONE');
  });

  it('filters non-string values from concerns array', () => {
    const output = `\`\`\`json\n{\n  "status": "DONE_WITH_CONCERNS",\n  "concerns": ["valid", 123, "also valid"]\n}\n\`\`\``;
    const result = parseStructuredOutput(output);
    expect(result).not.toBeNull();
    expect(result!.concerns).toEqual(['valid', 'also valid']);
  });
});
