import Database from 'better-sqlite3';
import { initSchema } from '../db/schema.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { createProjectRoutes } from '../server/routes/projects.js';
import { createTaskRoutes } from '../server/routes/tasks.js';
import { createRunRoutes } from '../server/routes/runs.js';
import { createArtifactRoutes } from '../server/routes/artifacts.js';
import { createEventRoutes } from '../server/routes/events.js';
import { createStageLogRoutes } from '../server/routes/stage-logs.js';
import type { AgentboardConfig } from '../types/index.js';

const execFileAsync = promisify(execFile);

/**
 * Create a fresh in-memory SQLite database with schema applied.
 * Each call returns an isolated DB — no test pollution.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

/**
 * Create a temporary git repository for integration tests.
 * Returns the repo path. Call the returned cleanup function after the test.
 */
export async function createTestRepo(): Promise<{
  repoPath: string;
  cleanup: () => void;
}> {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-test-'));
  await execFileAsync('git', ['init', repoPath]);
  await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoPath });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repoPath });

  // Create an initial commit so HEAD exists
  fs.writeFileSync(path.join(repoPath, 'README.md'), '# test');
  await execFileAsync('git', ['add', '.'], { cwd: repoPath });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repoPath });

  return {
    repoPath,
    cleanup: () => {
      fs.rmSync(repoPath, { recursive: true, force: true });
    },
  };
}

/**
 * Create a minimal AgentboardConfig for testing.
 */
export function createTestConfig(overrides?: Record<string, unknown>): AgentboardConfig {
  return {
    port: 4200,
    host: 'localhost',
    maxConcurrentTasks: 1,
    maxAttemptsPerTask: 3,
    maxReviewCycles: 2,
    maxSubcardDepth: 2,
    prDraft: true,
    autoMerge: false,
    securityMode: 'strict',
    commitPolicy: 'squash',
    formatPolicy: 'auto',
    branchPrefix: 'agentboard/',
    baseBranch: 'main',
    githubRemote: 'origin',
    prMethod: 'gh',
    modelDefaults: {
      planning: 'sonnet',
      implementation: 'opus',
      review: 'sonnet',
      security: 'sonnet',
      learning: 'haiku',
    },
    commands: {
      test: 'npm test',
      lint: 'npm run lint',
      format: 'npm run format:check',
      formatFix: 'npm run format',
      typecheck: 'npx tsc --noEmit',
      security: null,
    },
    notifications: {
      desktop: false,
      terminal: false,
    },
    ruflo: {
      enabled: false,
    },
    ...overrides,
  } as AgentboardConfig;
}

/**
 * Create a test Express app with all routes mounted, backed by the given DB.
 * Returns the app (for supertest) and an io instance.
 */
export function createTestApp(db: Database.Database) {
  const app = express();
  app.use(express.json());

  const server = http.createServer(app);
  const io = new SocketIOServer(server);

  app.use('/api/projects', createProjectRoutes(db));
  app.use('/api/tasks', createTaskRoutes(db, io));
  app.use('/api/runs', createRunRoutes(db));
  app.use('/api/artifacts', createArtifactRoutes(db));
  app.use('/api/events', createEventRoutes(db));
  app.use('/api/tasks/:id/stages', createStageLogRoutes(db));

  return { app, io, server };
}
