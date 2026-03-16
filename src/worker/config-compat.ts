import type { AgentboardConfig } from '../types/index.js';

/**
 * Normalize config loaded from disk, migrating old keys to new ones.
 * Handles existing config.json files that have reviewSpec/reviewCode
 * instead of the new 'review' key.
 */
export function normalizeConfig(raw: Record<string, unknown>): AgentboardConfig {
  const config = raw as AgentboardConfig;

  // Migrate old reviewSpec/reviewCode to review
  if (config.modelDefaults) {
    const md = config.modelDefaults as Record<string, string>;
    if (!md.review && (md.reviewSpec || md.reviewCode)) {
      md.review = md.reviewSpec ?? md.reviewCode ?? 'sonnet';
      delete md.reviewSpec;
      delete md.reviewCode;
    }
  }

  return config;
}
