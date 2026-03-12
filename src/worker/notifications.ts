import { createRequire } from 'node:module';
import type { AgentboardConfig } from '../types/index.js';

const require = createRequire(import.meta.url);

interface Notifier {
  notify: (options: { title: string; message: string; sound: boolean }) => void;
}

/**
 * Send a desktop notification if enabled in config.
 * Uses node-notifier for cross-platform notifications.
 */
export function notify(
  title: string,
  message: string,
  config: AgentboardConfig
): void {
  if (!config.notifications.desktop) return;

  try {
    const notifier = require('node-notifier') as Notifier;
    notifier.notify({
      title: `Agentboard: ${title}`,
      message,
      sound: true,
    });
  } catch {
    // Silently ignore if node-notifier is not available
    console.warn('[notifications] Failed to send desktop notification');
  }
}
