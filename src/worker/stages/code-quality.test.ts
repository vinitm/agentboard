import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import type { Task, AgentboardConfig, CodeQualityResult } from '../../types/index.js';
import { createTestDb, createTestConfig } from '../../test/helpers.js';

// Mock executeClaudeCode before importing the module under test
vi.mock('../executor.js', () => ({
  executeClaudeCode: vi.fn(),
}));

// Mock execFile for git diff commands
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:util', async () => {
  const actual = await vi.importActual<typeof import('node:util')>('node:util');
  return {
    ...actual,
    promisify: (fn: unknown) => fn,
  };
});

import { runCodeQuality, parseCodeQualityOutput } from './code-quality.js';
import { executeClaudeCode } from '../executor.js';
import { execFile } from 'node:child_process';

const mockedExecuteClaudeCode = vi.mocked(executeClaudeCode);
// promisify is mocked to pass-through, so execFile is used as a Promise-returning function
const mockedExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

function makeTask(overrides?: Partial<Task>): Task {
  return {
    id: 1,
    projectId: 'proj-1',
    parentTaskId: null,
    title: 'Test task',
    description: 'A test task',
    status: 'code_quality',
    riskLevel: 'low',
    priority: 1,
    columnPosition: 0,
    spec: null,
    blockedReason: null,
    claimedAt: null,
    claimedBy: null,
    chatSessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('code-quality', () => {
  let db: Database.Database;
  let config: AgentboardConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createTestDb();
    config = createTestConfig();

    // Insert project and task so foreign keys work
    db.prepare(
      `INSERT INTO projects (id, name, path, config_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('proj-1', 'test', '/tmp/test', '/tmp/test/.agentboard/config.json', new Date().toISOString(), new Date().toISOString());

    db.prepare(
      `INSERT INTO tasks (project_id, title, description, status, risk_level, priority, column_position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('proj-1', 'Test task', 'A test task', 'code_quality', 'low', 1, 0, new Date().toISOString(), new Date().toISOString());
  });

  it('exports runCodeQuality function', () => {
    expect(typeof runCodeQuality).toBe('function');
  });

  it('CodeQualityResult can express all issue severities and categories', () => {
    const result: CodeQualityResult = {
      passed: false,
      issues: [
        { severity: 'critical', category: 'security', message: 'SQL injection' },
        { severity: 'important', category: 'architecture', message: 'High coupling' },
        { severity: 'minor', category: 'quality', message: 'Naming convention', file: 'src/foo.ts', line: 42 },
        { severity: 'minor', category: 'testing', message: 'Missing edge case' },
      ],
      summary: 'Needs work',
    };
    expect(result.issues).toHaveLength(4);
    expect(result.issues[0].severity).toBe('critical');
    expect(result.issues[1].category).toBe('architecture');
    expect(result.issues[2].file).toBe('src/foo.ts');
    expect(result.issues[2].line).toBe(42);
  });

  describe('parseCodeQualityOutput', () => {
    it('parses valid JSON in code fences', () => {
      const output = '```json\n{"passed":true,"issues":[],"summary":"All good"}\n```';
      const result = parseCodeQualityOutput(output);
      expect(result.passed).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.summary).toBe('All good');
    });

    it('parses raw JSON without fences', () => {
      const output = '{"passed":false,"issues":[{"severity":"critical","category":"security","message":"Bad auth"}],"summary":"Fail"}';
      const result = parseCodeQualityOutput(output);
      expect(result.passed).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].severity).toBe('critical');
    });

    it('returns failure result for unparseable output', () => {
      const result = parseCodeQualityOutput('Some random text');
      expect(result.passed).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].severity).toBe('critical');
      expect(result.issues[0].category).toBe('quality');
    });

    it('filters invalid issues from output', () => {
      const output = JSON.stringify({
        passed: true,
        issues: [
          { severity: 'minor', category: 'quality', message: 'Valid' },
          { severity: 'invalid', category: 'quality', message: 'Bad severity' },
          { not: 'an issue' },
        ],
        summary: 'Mixed',
      });
      const result = parseCodeQualityOutput(output);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].message).toBe('Valid');
    });
  });

  describe('runCodeQuality', () => {
    it('returns passing result when no critical/important issues', async () => {
      const passResponse = JSON.stringify({
        passed: true,
        issues: [{ severity: 'minor', category: 'quality', message: 'Nit' }],
        summary: 'Looks good',
      });

      mockedExecFile.mockImplementation((...args: unknown[]) => {
        return Promise.resolve({ stdout: 'some diff output', stderr: '' });
      });

      mockedExecuteClaudeCode.mockResolvedValue({
        output: passResponse,
        exitCode: 0,
        tokensUsed: 500,
        duration: 3000,
      });

      const result = await runCodeQuality(db, makeTask(), '/tmp/worktree', config);
      expect(result.passed).toBe(true);
      expect(result.issues).toHaveLength(1);
      expect(result.summary).toBe('Looks good');
    });

    it('returns failing result when critical issues found', async () => {
      const failResponse = JSON.stringify({
        passed: false,
        issues: [{ severity: 'critical', category: 'security', message: 'SQL injection' }],
        summary: 'Security issue',
      });

      mockedExecFile.mockImplementation((...args: unknown[]) => {
        return Promise.resolve({ stdout: 'diff output', stderr: '' });
      });

      mockedExecuteClaudeCode.mockResolvedValue({
        output: failResponse,
        exitCode: 0,
        tokensUsed: 500,
        duration: 3000,
      });

      const result = await runCodeQuality(db, makeTask(), '/tmp/worktree', config);
      expect(result.passed).toBe(false);
      expect(result.issues[0].severity).toBe('critical');
    });

    it('creates a run record in the database', async () => {
      mockedExecFile.mockImplementation((...args: unknown[]) => {
        return Promise.resolve({ stdout: 'diff', stderr: '' });
      });

      mockedExecuteClaudeCode.mockResolvedValue({
        output: JSON.stringify({ passed: true, issues: [], summary: 'OK' }),
        exitCode: 0,
        tokensUsed: 100,
        duration: 1000,
      });

      await runCodeQuality(db, makeTask(), '/tmp/worktree', config);

      const runs = db.prepare('SELECT * FROM runs WHERE task_id = ?').all(1) as Array<Record<string, unknown>>;
      expect(runs.length).toBeGreaterThanOrEqual(1);
      expect(runs[0].stage).toBe('code_quality');
    });

    it('handles claude execution failure gracefully', async () => {
      mockedExecFile.mockImplementation((...args: unknown[]) => {
        return Promise.resolve({ stdout: 'diff', stderr: '' });
      });

      mockedExecuteClaudeCode.mockResolvedValue({
        output: 'Error: something went wrong',
        exitCode: 1,
        tokensUsed: 0,
        duration: 1000,
      });

      const result = await runCodeQuality(db, makeTask(), '/tmp/worktree', config);
      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('calls onOutput callback when provided', async () => {
      mockedExecFile.mockImplementation((...args: unknown[]) => {
        return Promise.resolve({ stdout: 'diff', stderr: '' });
      });

      mockedExecuteClaudeCode.mockResolvedValue({
        output: JSON.stringify({ passed: true, issues: [], summary: 'OK' }),
        exitCode: 0,
        tokensUsed: 100,
        duration: 1000,
      });

      const chunks: string[] = [];
      await runCodeQuality(db, makeTask(), '/tmp/worktree', config, (chunk) => {
        chunks.push(chunk);
      });

      // executeClaudeCode was called with an onOutput option
      expect(mockedExecuteClaudeCode).toHaveBeenCalledWith(
        expect.objectContaining({
          onOutput: expect.any(Function),
        })
      );
    });
  });
});
