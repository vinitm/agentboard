import { describe, it, expect, vi } from 'vitest';
import { notify } from './notifications.js';
import { createTestConfig } from '../test/helpers.js';

describe('notify', () => {
  it('does nothing when desktop notifications are disabled', () => {
    const config = createTestConfig({ notifications: { desktop: false, terminal: false } });

    // Should not throw and should not attempt to require node-notifier
    expect(() => notify('Test Title', 'Test message', config)).not.toThrow();
  });

  it('handles missing node-notifier gracefully (does not throw)', () => {
    const config = createTestConfig({ notifications: { desktop: true, terminal: false } });

    // node-notifier may not be installed in test env — should catch silently
    expect(() => notify('Test Title', 'Test message', config)).not.toThrow();
  });
});
