import type { Stage, RiskLevel, AgentboardConfig } from '../types/index.js';

export function selectModel(
  _stage: Stage,
  _riskLevel: RiskLevel,
  _config: AgentboardConfig
): string {
  return 'opus';
}
