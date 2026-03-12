import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { Server as SocketIOServer } from 'socket.io';
import type Database from 'better-sqlite3';
import type { AgentboardConfig } from '../types/index.js';
import { setupWebSocket } from './ws.js';
import { createProjectRoutes } from './routes/projects.js';
import { createTaskRoutes } from './routes/tasks.js';
import { createRunRoutes } from './routes/runs.js';
import { createArtifactRoutes } from './routes/artifacts.js';
import { createConfigRoutes } from './routes/config.js';
import { createEventRoutes } from './routes/events.js';

/**
 * Create and return an HTTP server with the full Express app and WebSocket support.
 */
export function createServer(
  db: Database.Database,
  config: AgentboardConfig
): http.Server {
  const app = express();

  // ── Middleware ──────────────────────────────────────────────────────
  app.use(express.json());

  // CORS
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Request logging
  app.use((req, _res, next) => {
    console.log(`[http] ${req.method} ${req.path}`);
    next();
  });

  // ── HTTP server + socket.io ────────────────────────────────────────
  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });
  setupWebSocket(io);

  // ── Config path (for config route) ─────────────────────────────────
  const configPath = path.resolve('.agentboard', 'config.json');

  // ── Health check ───────────────────────────────────────────────────
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // ── Mount routes ───────────────────────────────────────────────────
  app.use('/api/projects', createProjectRoutes(db));
  app.use('/api/tasks', createTaskRoutes(db, io));
  app.use('/api/runs', createRunRoutes(db));
  app.use('/api/artifacts', createArtifactRoutes(db));
  app.use('/api/config', createConfigRoutes(config, configPath));
  app.use('/api/events', createEventRoutes(db));

  // ── Error handling middleware ──────────────────────────────────────
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error('[error]', err.message);
      res.status(500).json({ error: err.message });
    }
  );

  return server;
}
