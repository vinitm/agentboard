// Mirrors the backend types from src/types/index.ts

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

export type Stage =
  | 'spec_review'
  | 'planning'
  | 'implementing'
  | 'checks'
  | 'code_quality'
  | 'final_review'
  | 'pr_creation';

export type StageLogStage = Stage | 'inline_fix' | 'learner';

export type StageLogStatus = 'running' | 'completed' | 'failed' | 'skipped';

export interface StageLog {
  id: string;
  taskId: number;
  runId: string | null;
  stage: StageLogStage;
  attempt: number;
  status: StageLogStatus;
  summary: string | null;
  tokensUsed: number | null;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
  terminalMode?: 'pty' | 'print';
}

export interface StageTransitionEvent {
  taskId: number;
  stage: StageLogStage;
  status: StageLogStatus;
  summary?: string;
  durationMs?: number;
  tokensUsed?: number;
}

export type RunStatus = 'running' | 'success' | 'failed' | 'cancelled';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface Project {
  id: string;
  name: string;
  path: string;
  configPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: number;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  riskLevel: RiskLevel;
  priority: number;
  spec: string | null;
  blockedReason: string | null;
  blockedAtStage: string | null;
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

export interface SpecResult {
  acceptanceCriteria: string[];
  fileScope: string[];
  outOfScope: string[];
  riskAssessment: string;
}

// Spec document shape (PM-authored, spec-kit inspired)
export interface SpecDocument {
  goal: string;
  userScenarios: string;
  successCriteria: string;
}

// Conversational task builder types
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ChatResponse {
  message: string;
  specUpdates: Partial<SpecDocument>;
  titleUpdate?: string;
  descriptionUpdate?: string;
  riskLevelUpdate?: RiskLevel;
  priorityUpdate?: number;
  isComplete: boolean;
  gaps: string[];
}

// SSE streaming event types for chat
export interface SSEChunkEvent {
  type: 'chunk';
  content: string;
}

export interface SSEDoneEvent {
  type: 'done';
  message: string;
  specUpdates: Partial<SpecDocument>;
  titleUpdate: string | null;
  descriptionUpdate: string | null;
  riskLevelUpdate: RiskLevel | null;
  isComplete: boolean;
}

export type SSEEvent = SSEChunkEvent | SSEDoneEvent;

// Persisted chat message from the server
export interface PersistedChatMessage {
  id: string;
  taskId: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface PlanReviewAction {
  action: 'approve' | 'reject';
  reason?: string;
  edits?: {
    planSummary?: string;
    steps?: Array<{ title: string; description: string }>;
  };
}

export interface PlanReviewData {
  planSummary: string;
  steps: Array<{ title: string; description: string }>;
  assumptions: string[];
  fileHints: string[];
  riskAssessment?: string;
}
