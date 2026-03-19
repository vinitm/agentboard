import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { ServerConfig } from '../types/index.js';

/**
 * Global agentboard directory: ~/.agentboard/
 * Contains: server.json, agentboard.db, repos.json, shutdown signal
 */
export const GLOBAL_DIR = path.join(os.homedir(), '.agentboard');
export const GLOBAL_DB_PATH = path.join(GLOBAL_DIR, 'agentboard.db');
export const GLOBAL_REGISTRY_PATH = path.join(GLOBAL_DIR, 'repos.json');
export const GLOBAL_SERVER_CONFIG_PATH = path.join(GLOBAL_DIR, 'server.json');
export const GLOBAL_SHUTDOWN_PATH = path.join(GLOBAL_DIR, 'shutdown');

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  port: 4200,
  host: '0.0.0.0',
  maxConcurrentTasks: 2,
  notifications: {
    desktop: true,
    terminal: true,
  },
};

/**
 * Ensure ~/.agentboard/ exists and return the global directory path.
 */
export function ensureGlobalDir(): string {
  if (!fs.existsSync(GLOBAL_DIR)) {
    fs.mkdirSync(GLOBAL_DIR, { recursive: true });
  }
  return GLOBAL_DIR;
}

/**
 * Load server config from ~/.agentboard/server.json, falling back to defaults.
 * Creates the file with defaults if it doesn't exist.
 */
export function loadServerConfig(): ServerConfig {
  ensureGlobalDir();

  if (!fs.existsSync(GLOBAL_SERVER_CONFIG_PATH)) {
    fs.writeFileSync(
      GLOBAL_SERVER_CONFIG_PATH,
      JSON.stringify(DEFAULT_SERVER_CONFIG, null, 2) + '\n'
    );
    return { ...DEFAULT_SERVER_CONFIG };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(GLOBAL_SERVER_CONFIG_PATH, 'utf-8'));
    return {
      ...DEFAULT_SERVER_CONFIG,
      ...raw,
      notifications: {
        ...DEFAULT_SERVER_CONFIG.notifications,
        ...(raw.notifications ?? {}),
      },
    } as ServerConfig;
  } catch {
    return { ...DEFAULT_SERVER_CONFIG };
  }
}
