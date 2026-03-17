import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildTaskSummary, type TaskMetrics } from './learner.js';

function createTestMetrics(overrides: Partial<TaskMetrics> = {}): TaskMetrics {
  return {
    taskId: 'task-123',
    title: 'Add user authentication',
    riskLevel: 'medium',
    outcome: 'success',
    totalTokensUsed: 15000,
    totalDuration: 120000,
    implementationAttempts: 2,
    reviewCycles: 1,
    checksPassedFirst: false,
    failedCheckNames: ['lint', 'typecheck'],
    reviewerFeedbackThemes: ['missing error handling', 'unused import'],
    timestamp: '2026-03-17T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildTaskSummary', () => {
  it('includes all metric fields in the summary', () => {
    const metrics = createTestMetrics();
    const summary = buildTaskSummary(metrics);

    expect(summary).toContain('Add user authentication');
    expect(summary).toContain('success');
    expect(summary).toContain('medium');
    expect(summary).toContain('Implementation Attempts:** 2');
    expect(summary).toContain('Review Cycles:** 1');
    expect(summary).toContain('Checks Passed First Try:** no');
    expect(summary).toContain('120s');
    expect(summary).toContain('15000');
  });

  it('lists failed check names', () => {
    const metrics = createTestMetrics();
    const summary = buildTaskSummary(metrics);

    expect(summary).toContain('Failed Checks:');
    expect(summary).toContain('- lint');
    expect(summary).toContain('- typecheck');
  });

  it('lists reviewer feedback themes', () => {
    const metrics = createTestMetrics();
    const summary = buildTaskSummary(metrics);

    expect(summary).toContain('Reviewer Feedback Themes:');
    expect(summary).toContain('- missing error handling');
    expect(summary).toContain('- unused import');
  });

  it('omits failed checks section when empty', () => {
    const metrics = createTestMetrics({ failedCheckNames: [] });
    const summary = buildTaskSummary(metrics);

    expect(summary).not.toContain('Failed Checks:');
  });

  it('omits reviewer feedback section when empty', () => {
    const metrics = createTestMetrics({ reviewerFeedbackThemes: [] });
    const summary = buildTaskSummary(metrics);

    expect(summary).not.toContain('Reviewer Feedback Themes:');
  });

  it('shows yes when checks passed first try', () => {
    const metrics = createTestMetrics({ checksPassedFirst: true });
    const summary = buildTaskSummary(metrics);

    expect(summary).toContain('Checks Passed First Try:** yes');
  });

  it('handles failed outcome', () => {
    const metrics = createTestMetrics({ outcome: 'failed' });
    const summary = buildTaskSummary(metrics);

    expect(summary).toContain('**Outcome:** failed');
  });
});

describe('learner prompt template', () => {
  const templatePath = path.resolve(__dirname, '../../../prompts/learner.md');

  it('exists on disk', () => {
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  it('contains the taskSummary interpolation variable', () => {
    const content = fs.readFileSync(templatePath, 'utf-8');
    expect(content).toContain('{taskSummary}');
  });

  it('instructs project-scoped saving only', () => {
    const content = fs.readFileSync(templatePath, 'utf-8');
    expect(content).toContain('.claude/skills/learned/');
    expect(content).toContain('NEVER write to `~/.claude/skills/learned/`');
  });

  it('instructs no user confirmation', () => {
    const content = fs.readFileSync(templatePath, 'utf-8');
    expect(content).toContain('Do NOT prompt for user confirmation');
  });

  it('requires JSON output format', () => {
    const content = fs.readFileSync(templatePath, 'utf-8');
    expect(content).toContain('"saved"');
  });
});

describe('parseLearningResult (via extractLearnings error paths)', () => {
  // We test the parsing indirectly through the module's exported function
  // since parseLearningResult is private. The extractLearnings function
  // wraps it with error handling.

  it('extractLearnings handles missing template gracefully', async () => {
    // This test verifies the try/catch in extractLearnings works.
    // We mock fs.existsSync to return false for the template path.
    const originalExistsSync = fs.existsSync;
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('prompts/learner.md')) return false;
      return originalExistsSync(p);
    });

    const { extractLearnings } = await import('./learner.js');
    const result = await extractLearnings(
      createTestMetrics(),
      '/tmp/test-worktree',
      'haiku'
    );

    expect(result.saved).toBe(false);
    expect(result.reason).toBeDefined();

    vi.restoreAllMocks();
  });
});
