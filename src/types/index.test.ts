import { describe, it, expect } from 'vitest';
import type {
  TaskStatus, Stage, ImplementerStatus, ImplementationResult,
  SpecReviewResult, ChatMessage, CodeQualityResult, FinalReviewResult,
} from './index.js';

describe('types', () => {
  it('TaskStatus includes new statuses', () => {
    const statuses: TaskStatus[] = [
      'backlog', 'ready', 'spec_review', 'planning', 'needs_plan_review',
      'implementing', 'checks', 'code_quality', 'final_review',
      'pr_creation', 'needs_human_review', 'done', 'blocked', 'failed', 'cancelled',
    ];
    expect(statuses).toHaveLength(15);
  });

  it('Stage includes new stages', () => {
    const stages: Stage[] = [
      'spec_review', 'planning', 'implementing', 'checks',
      'code_quality', 'final_review', 'pr_creation',
    ];
    expect(stages).toHaveLength(7);
  });

  it('ImplementerStatus has 4 values', () => {
    const statuses: ImplementerStatus[] = ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'];
    expect(statuses).toHaveLength(4);
  });

  it('ImplementationResult has structured fields', () => {
    const result: ImplementationResult = {
      status: 'DONE',
      output: 'test output',
    };
    expect(result.status).toBe('DONE');
  });

  it('ImplementationResult supports concerns', () => {
    const result: ImplementationResult = {
      status: 'DONE_WITH_CONCERNS',
      output: 'ok',
      concerns: ['file growing large'],
    };
    expect(result.concerns).toHaveLength(1);
  });

  it('ImplementationResult supports context needed', () => {
    const result: ImplementationResult = {
      status: 'NEEDS_CONTEXT',
      output: '',
      contextNeeded: ['what DB schema to use?'],
    };
    expect(result.contextNeeded).toHaveLength(1);
  });

  it('ImplementationResult supports blocker reason', () => {
    const result: ImplementationResult = {
      status: 'BLOCKED',
      output: '',
      blockerReason: 'conflicting requirements',
    };
    expect(result.blockerReason).toBe('conflicting requirements');
  });

  it('ChatMessage has required fields', () => {
    const msg: ChatMessage = {
      id: '1', taskId: 't1', role: 'user', content: 'hello', createdAt: 'now',
    };
    expect(msg.role).toBe('user');
  });

  it('SpecReviewResult has structured issues', () => {
    const result: SpecReviewResult = {
      passed: false,
      issues: [{ field: 'goal', severity: 'critical', message: 'too vague' }],
      suggestions: ['add acceptance criteria'],
    };
    expect(result.passed).toBe(false);
  });

  it('CodeQualityResult has categorized issues', () => {
    const result: CodeQualityResult = {
      passed: false,
      issues: [{ severity: 'critical', category: 'security', message: 'SQL injection', file: 'db.ts', line: 42 }],
      summary: 'Fix SQL injection',
    };
    expect(result.issues[0].category).toBe('security');
  });

  it('FinalReviewResult has spec compliance', () => {
    const result: FinalReviewResult = {
      passed: true,
      specCompliance: { criterionMet: { 'tests pass': true }, missingRequirements: [] },
      integrationIssues: [],
      summary: 'All good',
    };
    expect(result.specCompliance.criterionMet['tests pass']).toBe(true);
  });
});
