import type { Stage, RiskLevel, AgentboardConfig } from '../types/index.js';

export function selectModel(
  stage: Stage,
  riskLevel: RiskLevel,
  config: AgentboardConfig
): string {
  if (riskLevel === 'high' && stage === 'review_panel') {
    return 'opus';
  }

  const stageToConfigKey: Record<Stage, keyof AgentboardConfig['modelDefaults']> = {
    planning: 'planning',
    implementing: 'implementation',
    checks: 'implementation',
    review_panel: 'review',
    pr_creation: 'implementation',
  };

  const key = stageToConfigKey[stage];
  return config.modelDefaults[key];
}
