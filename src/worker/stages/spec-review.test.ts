import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { createTestDb, createTestConfig } from '../../test/helpers.js';
import { createProject, createTask } from '../../db/queries.js';
import type { Task } from '../../types/index.js';

// Mock executeClaudeCode so tests don't call the real CLI
vi.mock('../executor.js', () => ({
  executeClaudeCode: vi.fn().mockResolvedValue({
    output: JSON.stringify({
      passed: true,
      issues: [],
      suggestions: ['Consider adding error scenarios'],
    }),
    exitCode: 0,
    tokensUsed: 500,
    duration: 1000,
  }),
}));

// Mock fs.readFileSync for the prompt template (path differs between src/ and dist/)
const originalReadFileSync = fs.readFileSync;
vi.spyOn(fs, 'readFileSync').mockImplementation((filePath, options) => {
  if (typeof filePath === 'string' && filePath.includes('prompts/spec-review.md')) {
    return 'Review this spec:\n{goal}\n{userScenarios}\n{successCriteria}';
  }
  return originalReadFileSync(filePath, options as BufferEncoding);
});

import { runSpecReview } from './spec-review.js';

function createTaskWithSpec(
  db: ReturnType<typeof createTestDb>,
  spec: string | null
): Task {
  const project = createProject(db, {
    name: 'test-project',
    path: '/tmp/test',
    configPath: '/tmp/test/.agentboard/config.json',
  });
  return createTask(db, {
    projectId: project.id,
    title: 'Test task',
    description: 'A test task',
    status: 'spec_review',
    spec,
  });
}

describe('runSpecReview', () => {
  it('exports runSpecReview function', () => {
    expect(typeof runSpecReview).toBe('function');
  });

  it('fails when spec is null', async () => {
    const db = createTestDb();
    const task = createTaskWithSpec(db, null);
    const config = createTestConfig();

    const result = await runSpecReview(db, task, config);

    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].severity).toBe('critical');
    expect(result.issues[0].message).toMatch(/spec/i);
  });

  it('fails when spec fields are empty', async () => {
    const db = createTestDb();
    const spec = JSON.stringify({ goal: '', userScenarios: '', successCriteria: '' });
    const task = createTaskWithSpec(db, spec);
    const config = createTestConfig();

    const result = await runSpecReview(db, task, config);

    expect(result.passed).toBe(false);
    expect(result.issues.length).toBe(3);
    expect(result.issues.every((i) => i.severity === 'critical')).toBe(true);
    expect(result.issues.map((i) => i.field)).toEqual(
      expect.arrayContaining(['goal', 'userScenarios', 'successCriteria'])
    );
  });

  it('fails when spec fields are partially filled', async () => {
    const db = createTestDb();
    const spec = JSON.stringify({
      goal: 'Add user authentication',
      userScenarios: 'As a user, I want to log in',
      successCriteria: '',
    });
    const task = createTaskWithSpec(db, spec);
    const config = createTestConfig();

    const result = await runSpecReview(db, task, config);

    expect(result.passed).toBe(false);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].field).toBe('successCriteria');
    expect(result.issues[0].severity).toBe('critical');
  });

  it('passes basic completeness check when all fields filled', async () => {
    const db = createTestDb();
    const spec = JSON.stringify({
      goal: 'Add user authentication with OAuth2',
      userScenarios: 'As a user, I want to log in with Google so I can access my account',
      successCriteria: 'Users can log in with Google OAuth2 and see their dashboard',
    });
    const task = createTaskWithSpec(db, spec);
    const config = createTestConfig();

    const result = await runSpecReview(db, task, config);

    // Completeness passes, AI mock returns passed: true
    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.suggestions).toEqual(['Consider adding error scenarios']);
  });
});
