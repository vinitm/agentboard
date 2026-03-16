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

  return raw as unknown as AgentboardConfig;
}
