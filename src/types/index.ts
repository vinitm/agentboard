// ── Kanban column states ──────────────────────────────────────────────
export type TaskStatus =
  | 'backlog'
  | 'ready'
  | 'planning'
  | 'implementing'
  | 'checks'
  | 'review_spec'
  | 'review_code'
  | 'needs_human_review'
  | 'done'
  | 'blocked'
  | 'failed'
  | 'cancelled';

// ── Stage enum for worker pipeline ───────────────────────────────────
export type Stage =
  | 'planning'
  | 'implementing'
  | 'checks'
  | 'review_spec'
  | 'review_code'
  | 'pr_creation';

// ── Run status ───────────────────────────────────────────────────────
export type RunStatus = 'running' | 'success' | 'failed' | 'cancelled';

// ── Git ref status ───────────────────────────────────────────────────
export type GitRefStatus = 'local' | 'pushed' | 'pr_open';

// ── Risk level ───────────────────────────────────────────────────────
export type RiskLevel = 'low' | 'medium' | 'high';

// ── DB entity interfaces ─────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  path: string;           // repo path
  configPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  parentTaskId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  riskLevel: RiskLevel;
  priority: number;
  columnPosition: number;
  spec: string | null;        // JSON text for template fields
  blockedReason: string | null;
  claimedAt: string | null;
  claimedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  taskId: string;
  stage: Stage;
  status: RunStatus;
  attempt: number;
  tokensUsed: number | null;
  modelUsed: string | null;
  input: string | null;
  output: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface Artifact {
  id: string;
  runId: string;
  type: string;
  name: string;
  content: string;
  createdAt: string;
}

export interface GitRef {
  id: string;
  taskId: string;
  branch: string;
  worktreePath: string | null;
  status: GitRefStatus;
  createdAt: string;
}

export interface Event {
  id: string;
  taskId: string;
  runId: string | null;
  type: string;
  payload: string;        // JSON
  createdAt: string;
}

// ── Config interface ─────────────────────────────────────────────────

export interface AgentboardConfig {
  projectName: string;
  repoPath: string;
  dbPath: string;
  server: {
    port: number;
    host: string;
  };
  worker: {
    maxConcurrency: number;
    maxRetries: number;
    retryDelayMs: number;
  };
  git: {
    branchPrefix: string;
    useWorktrees: boolean;
  };
  review: {
    autoApproveRiskLevels: RiskLevel[];
    requireHumanReview: boolean;
  };
}
