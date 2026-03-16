// Mirrors the backend types from src/types/index.ts

export type TaskStatus =
  | 'backlog'
  | 'ready'
  | 'spec'
  | 'planning'
  | 'implementing'
  | 'checks'
  | 'review_panel'
  | 'needs_human_review'
  | 'done'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export type Stage =
  | 'spec'
  | 'planning'
  | 'implementing'
  | 'checks'
  | 'review_panel'
  | 'pr_creation';

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
  id: string;
  projectId: string;
  parentTaskId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  riskLevel: RiskLevel;
  priority: number;
  columnPosition: number;
  spec: string | null;
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

export interface SpecResult {
  acceptanceCriteria: string[];
  fileScope: string[];
  outOfScope: string[];
  riskAssessment: string;
}

export interface SpecTemplate {
  context: string;
  acceptanceCriteria: string;
  constraints: string;
  verification: string;
  riskLevel: RiskLevel;
  infrastructureAllowed: string;
}

export interface DecisionPoint {
  question: string;
  options: string[];
  defaultIndex: number;
  specField: string;
}
