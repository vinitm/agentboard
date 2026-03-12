import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentboardConfig } from '../../types/index.js';

export function createConfigRoutes(config: AgentboardConfig, configPath: string): Router {
  const router = Router();

  // GET /api/config — get current config
  router.get('/', (_req, res) => {
    // Read fresh from disk if file exists, otherwise return in-memory config
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const diskConfig = JSON.parse(raw) as AgentboardConfig;
        res.json(diskConfig);
        return;
      }
    } catch {
      // Fall through to in-memory config
    }
    res.json(config);
  });

  // PUT /api/config — update config (partial update, merge with existing)
  router.put('/', (req, res) => {
    const updates = req.body as Partial<AgentboardConfig>;

    // Read current config
    let current: AgentboardConfig;
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        current = JSON.parse(raw) as AgentboardConfig;
      } else {
        current = { ...config };
      }
    } catch {
      current = { ...config };
    }

    // Shallow merge top-level, deep merge nested objects
    const merged: AgentboardConfig = {
      ...current,
      ...updates,
      modelDefaults: {
        ...current.modelDefaults,
        ...(updates.modelDefaults ?? {}),
      },
      commands: {
        ...current.commands,
        ...(updates.commands ?? {}),
      },
      notifications: {
        ...current.notifications,
        ...(updates.notifications ?? {}),
      },
      ruflo: {
        ...current.ruflo,
        ...(updates.ruflo ?? {}),
      },
    };

    // Write to disk
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf-8');

    res.json(merged);
  });

  return router;
}
