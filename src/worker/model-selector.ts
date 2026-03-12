import type { Stage, RiskLevel, AgentboardConfig } from '../types/index.js';

/**
 * Select the model alias for a given stage and risk level.
 *
 * Uses config.modelDefaults to map stage -> model alias, with an override:
 * if riskLevel is 'high', use 'opus' for review_spec and review_code stages.
 */
export function selectModel(
  stage: Stage,
  riskLevel: RiskLevel,
  config: AgentboardConfig
): string {
  // High-risk override for review stages
  if (riskLevel === 'high' && (stage === 'review_spec' || stage === 'review_code')) {
    return 'opus';
  }

  const stageToConfigKey: Record<Stage, keyof AgentboardConfig['modelDefaults']> = {
    planning: 'planning',
    implementing: 'implementation',
    checks: 'implementation',
    review_spec: 'reviewSpec',
    review_code: 'reviewCode',
    pr_creation: 'implementation',
  };

  const key = stageToConfigKey[stage];
  return config.modelDefaults[key];
}
