import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type {
  Project,
  Task,
  TaskStatus,
  RiskLevel,
  Run,
  RunStatus,
  Stage,
  Artifact,
  GitRef,
  GitRefStatus,
  Event,
  TaskLog,
  ChatMessage,
} from '../types/index.js';

// ── Helper: snake_case row → camelCase object ────────────────────────

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    path: row.path as string,
    configPath: row.config_path as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as number,
    projectId: row.project_id as string,
    title: row.title as string,
    description: row.description as string,
    status: row.status as TaskStatus,
    riskLevel: row.risk_level as RiskLevel,
    priority: row.priority as number,
    spec: (row.spec as string) ?? null,
    blockedReason: (row.blocked_reason as string) ?? null,
    blockedAtStage: (row.blocked_at_stage as string) ?? null,
    claimedAt: (row.claimed_at as string) ?? null,
    claimedBy: (row.claimed_by as string) ?? null,
    chatSessionId: (row.chat_session_id as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToRun(row: Record<string, unknown>): Run {
  return {
    id: row.id as string,
    taskId: row.task_id as number,
    stage: row.stage as Stage,
    status: row.status as RunStatus,
    attempt: row.attempt as number,
    tokensUsed: (row.tokens_used as number) ?? null,
    modelUsed: (row.model_used as string) ?? null,
    input: (row.input as string) ?? null,
    output: (row.output as string) ?? null,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string) ?? null,
  };
}

function rowToArtifact(row: Record<string, unknown>): Artifact {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    type: row.type as string,
    name: row.name as string,
    content: row.content as string,
    createdAt: row.created_at as string,
  };
}

function rowToGitRef(row: Record<string, unknown>): GitRef {
  return {
    id: row.id as string,
    taskId: row.task_id as number,
    branch: row.branch as string,
    worktreePath: (row.worktree_path as string) ?? null,
    status: row.status as GitRefStatus,
    createdAt: row.created_at as string,
  };
}

function rowToEvent(row: Record<string, unknown>): Event {
  return {
    id: row.id as string,
    taskId: row.task_id as number,
    runId: (row.run_id as string) ?? null,
    type: row.type as string,
    payload: row.payload as string,
    createdAt: row.created_at as string,
  };
}

// ── Projects ─────────────────────────────────────────────────────────

export function createProject(
  db: Database.Database,
  data: Pick<Project, 'name' | 'path' | 'configPath'>
): Project {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, name, path, config_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, data.name, data.path, data.configPath, now, now);
  return getProjectById(db, id)!;
}

export function getProjectById(
  db: Database.Database,
  id: string
): Project | undefined {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToProject(row) : undefined;
}

export function listProjects(db: Database.Database): Project[] {
  const rows = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Record<string, unknown>[];
  return rows.map(rowToProject);
}

export function getProjectByPath(
  db: Database.Database,
  path: string
): Project | undefined {
  const row = db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToProject(row) : undefined;
}

export function updateProject(
  db: Database.Database,
  id: string,
  data: Partial<Pick<Project, 'name' | 'path' | 'configPath'>>
): Project | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.path !== undefined) { fields.push('path = ?'); values.push(data.path); }
  if (data.configPath !== undefined) { fields.push('config_path = ?'); values.push(data.configPath); }

  if (fields.length === 0) return getProjectById(db, id);

  const now = new Date().toISOString();
  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);

  db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getProjectById(db, id);
}

export function deleteProject(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

// ── Tasks ────────────────────────────────────────────────────────────

export interface CreateTaskData {
  projectId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  riskLevel?: RiskLevel;
  priority?: number;
  spec?: string | null;
}

export function createTask(
  db: Database.Database,
  data: CreateTaskData
): Task {
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO tasks (project_id, title, description, status,
       risk_level, priority, spec, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.projectId,
    data.title,
    data.description ?? '',
    data.status ?? 'backlog',
    data.riskLevel ?? 'low',
    data.priority ?? 0,
    data.spec ?? null,
    now,
    now
  );
  return getTaskById(db, Number(result.lastInsertRowid))!;
}

export function getTaskById(
  db: Database.Database,
  id: number
): Task | undefined {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToTask(row) : undefined;
}

export function listTasksByProject(
  db: Database.Database,
  projectId: string
): Task[] {
  const rows = db
    .prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY priority DESC, created_at ASC')
    .all(projectId) as Record<string, unknown>[];
  return rows.map(rowToTask);
}

export function listTasksByStatus(
  db: Database.Database,
  projectId: string,
  status: TaskStatus
): Task[] {
  const rows = db
    .prepare('SELECT * FROM tasks WHERE project_id = ? AND status = ? ORDER BY priority DESC, created_at ASC')
    .all(projectId, status) as Record<string, unknown>[];
  return rows.map(rowToTask);
}

export interface UpdateTaskData {
  title?: string;
  description?: string;
  status?: TaskStatus;
  riskLevel?: RiskLevel;
  priority?: number;
  spec?: string | null;
  blockedReason?: string | null;
  blockedAtStage?: string | null;
  chatSessionId?: string | null;
}

export function updateTask(
  db: Database.Database,
  id: number,
  data: UpdateTaskData
): Task | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title); }
  if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.riskLevel !== undefined) { fields.push('risk_level = ?'); values.push(data.riskLevel); }
  if (data.priority !== undefined) { fields.push('priority = ?'); values.push(data.priority); }
  if (data.spec !== undefined) { fields.push('spec = ?'); values.push(data.spec); }
  if (data.blockedReason !== undefined) { fields.push('blocked_reason = ?'); values.push(data.blockedReason); }
  if (data.blockedAtStage !== undefined) { fields.push('blocked_at_stage = ?'); values.push(data.blockedAtStage); }
  if (data.chatSessionId !== undefined) { fields.push('chat_session_id = ?'); values.push(data.chatSessionId); }

  if (fields.length === 0) return getTaskById(db, id);

  const now = new Date().toISOString();
  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);

  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getTaskById(db, id);
}

export function claimTask(
  db: Database.Database,
  id: number,
  claimedBy: string
): boolean {
  const now = new Date().toISOString();
  const result = db.prepare(
    `UPDATE tasks SET claimed_at = ?, claimed_by = ?, updated_at = ? WHERE id = ? AND claimed_by IS NULL`
  ).run(now, claimedBy, now, id);
  return result.changes === 1;
}

export function unclaimTask(
  db: Database.Database,
  id: number
): Task | undefined {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE tasks SET claimed_at = NULL, claimed_by = NULL, updated_at = ? WHERE id = ?`
  ).run(now, id);
  return getTaskById(db, id);
}

export function deleteTask(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

export function getStaleClaimed(db: Database.Database, staleMinutes: number = 15): Task[] {
  const rows = db.prepare(
    `SELECT * FROM tasks WHERE claimed_by IS NOT NULL AND claimed_at < datetime('now', '-' || ? || ' minutes')`
  ).all(staleMinutes) as Record<string, unknown>[];
  return rows.map(rowToTask);
}

// ── Runs ─────────────────────────────────────────────────────────────

export interface CreateRunData {
  taskId: number;
  stage: Stage;
  attempt?: number;
  modelUsed?: string | null;
  input?: string | null;
}

export function createRun(
  db: Database.Database,
  data: CreateRunData
): Run {
  const id = uuidv4();
  const now = new Date().toISOString();
  if (data.attempt != null) {
    db.prepare(
      `INSERT INTO runs (id, task_id, stage, status, attempt, model_used, input, started_at)
       VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`
    ).run(id, data.taskId, data.stage, data.attempt, data.modelUsed ?? null, data.input ?? null, now);
  } else {
    db.prepare(
      `INSERT INTO runs (id, task_id, stage, status, attempt, model_used, input, started_at)
       VALUES (?, ?, ?, 'running',
         COALESCE((SELECT MAX(attempt) FROM runs WHERE task_id = ? AND stage = ?), 0) + 1,
         ?, ?, ?)`
    ).run(id, data.taskId, data.stage, data.taskId, data.stage, data.modelUsed ?? null, data.input ?? null, now);
  }
  return getRunById(db, id)!;
}

export function getRunById(
  db: Database.Database,
  id: string
): Run | undefined {
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToRun(row) : undefined;
}

export function listRunsByTask(
  db: Database.Database,
  taskId: number
): Run[] {
  const rows = db
    .prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY started_at DESC')
    .all(taskId) as Record<string, unknown>[];
  return rows.map(rowToRun);
}

export function getLatestRunByTaskAndStage(
  db: Database.Database,
  taskId: number,
  stage: Stage
): Run | undefined {
  const row = db
    .prepare(
      'SELECT * FROM runs WHERE task_id = ? AND stage = ? ORDER BY attempt DESC, started_at DESC LIMIT 1'
    )
    .get(taskId, stage) as Record<string, unknown> | undefined;
  return row ? rowToRun(row) : undefined;
}

export interface UpdateRunData {
  status?: RunStatus;
  tokensUsed?: number | null;
  modelUsed?: string | null;
  output?: string | null;
  finishedAt?: string | null;
}

export function updateRun(
  db: Database.Database,
  id: string,
  data: UpdateRunData
): Run | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.tokensUsed !== undefined) { fields.push('tokens_used = ?'); values.push(data.tokensUsed); }
  if (data.modelUsed !== undefined) { fields.push('model_used = ?'); values.push(data.modelUsed); }
  if (data.output !== undefined) { fields.push('output = ?'); values.push(data.output); }
  if (data.finishedAt !== undefined) { fields.push('finished_at = ?'); values.push(data.finishedAt); }

  if (fields.length === 0) return getRunById(db, id);

  values.push(id);
  db.prepare(`UPDATE runs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getRunById(db, id);
}

export function deleteRun(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM runs WHERE id = ?').run(id);
}

// ── Artifacts ────────────────────────────────────────────────────────

export interface CreateArtifactData {
  runId: string;
  type: string;
  name: string;
  content: string;
}

export function createArtifact(
  db: Database.Database,
  data: CreateArtifactData
): Artifact {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO artifacts (id, run_id, type, name, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, data.runId, data.type, data.name, data.content, now);
  return getArtifactById(db, id)!;
}

export function getArtifactById(
  db: Database.Database,
  id: string
): Artifact | undefined {
  const row = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToArtifact(row) : undefined;
}

export function listArtifactsByRun(
  db: Database.Database,
  runId: string
): Artifact[] {
  const rows = db
    .prepare('SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at ASC')
    .all(runId) as Record<string, unknown>[];
  return rows.map(rowToArtifact);
}

export function deleteArtifact(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM artifacts WHERE id = ?').run(id);
}

// ── Git Refs ─────────────────────────────────────────────────────────

export interface CreateGitRefData {
  taskId: number;
  branch: string;
  worktreePath?: string | null;
  status?: GitRefStatus;
}

export function createGitRef(
  db: Database.Database,
  data: CreateGitRefData
): GitRef {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO git_refs (id, task_id, branch, worktree_path, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, data.taskId, data.branch, data.worktreePath ?? null, data.status ?? 'local', now);
  return getGitRefById(db, id)!;
}

export function getGitRefById(
  db: Database.Database,
  id: string
): GitRef | undefined {
  const row = db.prepare('SELECT * FROM git_refs WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToGitRef(row) : undefined;
}

export function listGitRefsByTask(
  db: Database.Database,
  taskId: number
): GitRef[] {
  const rows = db
    .prepare('SELECT * FROM git_refs WHERE task_id = ? ORDER BY created_at DESC')
    .all(taskId) as Record<string, unknown>[];
  return rows.map(rowToGitRef);
}

export function updateGitRef(
  db: Database.Database,
  id: string,
  data: Partial<Pick<GitRef, 'status' | 'worktreePath'>>
): GitRef | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.worktreePath !== undefined) { fields.push('worktree_path = ?'); values.push(data.worktreePath); }

  if (fields.length === 0) return getGitRefById(db, id);

  values.push(id);
  db.prepare(`UPDATE git_refs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getGitRefById(db, id);
}

export function deleteGitRef(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM git_refs WHERE id = ?').run(id);
}

// ── Events ───────────────────────────────────────────────────────────

export interface CreateEventData {
  taskId: number;
  runId?: string | null;
  type: string;
  payload?: string;
}

export function createEvent(
  db: Database.Database,
  data: CreateEventData
): Event {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO events (id, task_id, run_id, type, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, data.taskId, data.runId ?? null, data.type, data.payload ?? '{}', now);
  return getEventById(db, id)!;
}

export function getEventById(
  db: Database.Database,
  id: string
): Event | undefined {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToEvent(row) : undefined;
}

export function listEventsByTask(
  db: Database.Database,
  taskId: number
): Event[] {
  const rows = db
    .prepare('SELECT * FROM events WHERE task_id = ? ORDER BY created_at ASC')
    .all(taskId) as Record<string, unknown>[];
  return rows.map(rowToEvent);
}

export function listEventsByProject(
  db: Database.Database,
  projectId: string,
  limit: number = 50,
  cursor?: string
): (Event & { taskTitle: string })[] {
  const cursorClause = cursor ? 'AND e.id < ?' : '';
  const params: unknown[] = [projectId];
  if (cursor) params.push(cursor);
  params.push(limit);

  const rows = db
    .prepare(
      `SELECT e.*, t.title as task_title FROM events e
       JOIN tasks t ON e.task_id = t.id
       WHERE t.project_id = ? ${cursorClause}
       ORDER BY e.id DESC
       LIMIT ?`
    )
    .all(...params) as (Record<string, unknown>)[];

  return rows.map((row) => ({
    ...rowToEvent(row),
    taskTitle: row.task_title as string,
  }));
}

export function deleteEvent(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
}

// ── Task Logs ─────────────────────────────────────────────────────────

function rowToTaskLog(row: Record<string, unknown>): TaskLog {
  return {
    id: row.id as string,
    taskId: row.task_id as number,
    projectId: row.project_id as string,
    logPath: row.log_path as string,
    sizeBytes: row.size_bytes as number,
    createdAt: row.created_at as string,
  };
}

export interface CreateTaskLogData {
  taskId: number;
  projectId: string;
  logPath: string;
  sizeBytes?: number;
}

export function createTaskLog(
  db: Database.Database,
  data: CreateTaskLogData
): TaskLog {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO task_logs (id, task_id, project_id, log_path, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, data.taskId, data.projectId, data.logPath, data.sizeBytes ?? 0, now);
  return getTaskLogById(db, id)!;
}

export function getTaskLogById(
  db: Database.Database,
  id: string
): TaskLog | undefined {
  const row = db.prepare('SELECT * FROM task_logs WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToTaskLog(row) : undefined;
}

export function getTaskLogByTaskId(
  db: Database.Database,
  taskId: number
): TaskLog | undefined {
  const row = db.prepare('SELECT * FROM task_logs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(taskId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToTaskLog(row) : undefined;
}

export function listTaskLogsByProject(
  db: Database.Database,
  projectId: string
): TaskLog[] {
  const rows = db
    .prepare('SELECT * FROM task_logs WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as Record<string, unknown>[];
  return rows.map(rowToTaskLog);
}

export function updateTaskLogSize(
  db: Database.Database,
  id: string,
  sizeBytes: number
): void {
  db.prepare('UPDATE task_logs SET size_bytes = ? WHERE id = ?').run(sizeBytes, id);
}

// ── Chat Messages ─────────────────────────────────────────────────────

function rowToChatMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: row.id as string,
    taskId: row.task_id as number,
    role: row.role as 'user' | 'assistant',
    content: row.content as string,
    createdAt: row.created_at as string,
  };
}

export interface CreateChatMessageData {
  taskId: number;
  role: 'user' | 'assistant';
  content: string;
}

export function createChatMessage(
  db: Database.Database,
  data: CreateChatMessageData
): ChatMessage {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO chat_messages (id, task_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, data.taskId, data.role, data.content, now);
  const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id) as Record<string, unknown>;
  return rowToChatMessage(row);
}

export function listChatMessagesByTask(
  db: Database.Database,
  taskId: number
): ChatMessage[] {
  const rows = db
    .prepare('SELECT * FROM chat_messages WHERE task_id = ? ORDER BY created_at ASC')
    .all(taskId) as Record<string, unknown>[];
  return rows.map(rowToChatMessage);
}

export function deleteChatMessagesByTask(
  db: Database.Database,
  taskId: number
): void {
  db.prepare('DELETE FROM chat_messages WHERE task_id = ?').run(taskId);
}
