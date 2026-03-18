// ── Kanban column states ──────────────────────────────────────────────
export type TaskStatus =
  | 'backlog'
  | 'ready'
  | 'spec_review'
  | 'planning'
  | 'needs_plan_review'
  | 'implementing'
  | 'checks'
  | 'code_quality'
  | 'final_review'
  | 'pr_creation'
  | 'needs_human_review'
  | 'done'
  | 'blocked'
  | 'failed'
  | 'cancelled';

// ── Stage enum for worker pipeline ───────────────────────────────────
export type Stage =
  | 'spec_review'
  | 'planning'
  | 'implementing'
  | 'checks'
  | 'code_quality'
  | 'final_review'
  | 'pr_creation';

// ── Stage log types (extends Stage with sub-stages) ─────────────────
export type StageLogStage = Stage | 'inline_fix' | 'learner';

export type StageLogStatus = 'running' | 'completed' | 'failed' | 'skipped';

export interface StageLog {
  id: string;
  taskId: number;
  projectId: string;
  runId: string | null;
  stage: StageLogStage;
  subtaskId: number | null;
  attempt: number;
  filePath: string;
  status: StageLogStatus;
  summary: string | null;
  tokensUsed: number | null;
  durationMs: number | null;
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
}

export interface StageTransitionEvent {
  taskId: number;
  stage: StageLogStage;
  subtaskId?: number;
  status: StageLogStatus;
  summary?: string;
  durationMs?: number;
  tokensUsed?: number;
}

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
  id: number;
  projectId: string;
  parentTaskId: number | null;
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
  chatSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  taskId: number;
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
  taskId: number;
  branch: string;
  worktreePath: string | null;
  status: GitRefStatus;
  createdAt: string;
}

export interface Event {
  id: string;
  taskId: number;
  runId: string | null;
  type: string;
  payload: string;        // JSON
  createdAt: string;
}

// ── Implementer structured status ───────────────────────────────────
export type ImplementerStatus = 'DONE' | 'DONE_WITH_CONCERNS' | 'NEEDS_CONTEXT' | 'BLOCKED';

export interface ImplementationResult {
  status: ImplementerStatus;
  output: string;
  concerns?: string[];
  contextNeeded?: string[];
  blockerReason?: string;
}

// ── Spec review result ──────────────────────────────────────────────
export interface SpecReviewResult {
  passed: boolean;
  issues: Array<{
    field: 'goal' | 'userScenarios' | 'successCriteria';
    severity: 'critical' | 'warning';
    message: string;
  }>;
  suggestions: string[];
}

// ── Chat message ────────────────────────────────────────────────────
export interface ChatMessage {
  id: string;
  taskId: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

// ── Code quality review result ──────────────────────────────────────
export interface CodeQualityResult {
  passed: boolean;
  issues: Array<{
    severity: 'critical' | 'important' | 'minor';
    category: 'quality' | 'testing' | 'security' | 'architecture';
    message: string;
    file?: string;
    line?: number;
  }>;
  summary: string;
}

// ── Final review result ─────────────────────────────────────────────
export interface FinalReviewResult {
  passed: boolean;
  specCompliance: {
    criterionMet: Record<string, boolean>;
    missingRequirements: string[];
  };
  integrationIssues: string[];
  summary: string;
}

// ── Config interface ─────────────────────────────────────────────────

export interface ModelDefaults {
  planning: string;
  implementation: string;
  review: string;
  security: string;
  learning: string;
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
  maxRalphIterations: number;
}

// ── Server-level config (stored at ~/.agentboard/server.json) ───────
export interface ServerConfig {
  port: number;
  host: string;
  maxConcurrentTasks: number;
  notifications: Notifications;
}

// ── Spec result from spec-generator stage ───────────────────────────
export interface SpecResult {
  acceptanceCriteria: string[];
  fileScope: string[];
  outOfScope: string[];
  riskAssessment: string;
}

// ── Task log metadata ───────────────────────────────────────────────
export interface TaskLog {
  id: string;
  taskId: number;
  projectId: string;
  logPath: string;
  sizeBytes: number;
  createdAt: string;
}

// ── Spec document for task creation (PM-authored, spec-kit inspired) ─
export interface SpecDocument {
  goal: string;
  userScenarios: string;
  successCriteria: string;
}

// ── Plan review action from engineer ────────────────────────────────
export interface PlanReviewAction {
  action: 'approve' | 'reject';
  reason?: string;
  edits?: {
    planSummary?: string;
    subtasks?: Array<{ title: string; description: string }>;
  };
}
