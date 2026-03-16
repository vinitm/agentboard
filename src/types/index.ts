// ── Kanban column states ──────────────────────────────────────────────
export type TaskStatus =
  | 'backlog'
  | 'ready'
  | 'planning'
  | 'implementing'
  | 'checks'
  | 'review_panel'
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
  | 'review_panel'
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

export interface ModelDefaults {
  planning: string;
  implementation: string;
  review: string;
  security: string;
}

export interface Commands {
  test: string | null;
  lint: string | null;
  format: string | null;
  formatFix: string | null;
  typecheck: string | null;
  security: string | null;
}

export interface Notifications {
  desktop: boolean;
  terminal: boolean;
}

export interface RufloConfig {
  enabled: boolean;
}

export interface AgentboardConfig {
  port: number;
  host: string;
  maxConcurrentTasks: number;
  maxAttemptsPerTask: number;
  maxReviewCycles: number;
  maxSubcardDepth: number;
  prDraft: boolean;
  autoMerge: boolean;
  securityMode: string;
  commitPolicy: string;
  formatPolicy: string;
  branchPrefix: string;
  baseBranch: string;
  githubRemote: string;
  prMethod: string;
  modelDefaults: ModelDefaults;
  commands: Commands;
  notifications: Notifications;
  ruflo: RufloConfig;
}

// ── Decision points for task creation ───────────────────────────────
export interface DecisionPoint {
  question: string;
  options: string[];
  defaultIndex: number;
  specField: string;
}
