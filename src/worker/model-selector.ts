import type { Stage, RiskLevel, AgentboardConfig } from '../types/index.js';

/**
 * Stage-based model routing table.
 *
 * Routes 80% of work to Sonnet, reserves Opus for complex implementation,
 * and uses Haiku for fire-and-forget tasks like learning extraction.
 *
 * For high-risk tasks, implementation and planning are upgraded to Opus.
 */
const STAGE_MODEL_MAP: Record<string, 'planning' | 'implementation' | 'review' | 'security' | 'learning'> = {
  spec_review: 'review',
  planning: 'planning',
  implementing: 'implementation',
  checks: 'review',         // checks don't use a model, but if needed default to review
  code_quality: 'review',
  final_review: 'review',
  pr_creation: 'review',
};

/**
 * Select the appropriate model for a pipeline stage based on
 * the stage type, task risk level, and project config.
 *
 * Uses config.modelDefaults to map stages to configured model names.
 * High-risk tasks upgrade planning to the implementation model (Opus).
 */
export function selectModel(
  stage: Stage,
  riskLevel: RiskLevel,
  config: AgentboardConfig
): string {
  const configKey = STAGE_MODEL_MAP[stage] ?? 'review';
  let model = config.modelDefaults[configKey];

  // High-risk tasks upgrade planning to the implementation model
  if (riskLevel === 'high' && stage === 'planning') {
    model = config.modelDefaults.implementation;
  }

  return model;
}
