import type { AgentboardConfig } from '../types/index.js';

/**
 * Normalize config loaded from disk, migrating old keys to new ones.
 * Handles existing config.json files that have reviewSpec/reviewCode
 * instead of the new 'review' key.
 */
export function normalizeConfig(raw: Record<string, unknown>): AgentboardConfig {
  // Migrate old reviewSpec/reviewCode to review
  if (raw.modelDefaults && typeof raw.modelDefaults === 'object') {
    const md = raw.modelDefaults as Record<string, unknown>;
    if (!md['review'] && (md['reviewSpec'] || md['reviewCode'])) {
      md['review'] = md['reviewSpec'] ?? md['reviewCode'] ?? 'sonnet';
      delete md['reviewSpec'];
      delete md['reviewCode'];
    }
  }

  if (raw.maxRalphIterations === undefined) {
    raw.maxRalphIterations = 5;
  }

  // Default learning model to haiku for cost-effective learning extraction
  if (raw.modelDefaults && typeof raw.modelDefaults === 'object') {
    const md = raw.modelDefaults as Record<string, unknown>;
    if (!md['learning']) {
      md['learning'] = 'haiku';
    }
  }

  // Default new config fields
  if (raw.autoMergeMode === undefined) {
    // Migrate boolean autoMerge to autoMergeMode
    raw.autoMergeMode = raw.autoMerge === true ? 'low-risk' : 'off';
  }

  if (raw.autoPlanApproval === undefined) {
    raw.autoPlanApproval = false;
  }

  if (raw.maxCostPerTask === undefined) {
    raw.maxCostPerTask = null;
  }

  if (raw.maxInlineFixAttempts === undefined) {
    raw.maxInlineFixAttempts = 2;
  }

  return raw as unknown as AgentboardConfig;
}
