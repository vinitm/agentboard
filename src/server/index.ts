import express from 'express';
import http from 'node:http';
import type Database from 'better-sqlite3';
import type { AgentboardConfig } from '../types/index.js';

/**
 * Create and return an HTTP server with a minimal Express app.
 * This is a placeholder — real routes will be added in a later milestone.
 */
export function createServer(
  _db: Database.Database,
  config: AgentboardConfig
): http.Server {
  const app = express();

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const server = http.createServer(app);
  server.listen(config.port, config.host);
  return server;
}
