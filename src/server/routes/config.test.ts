import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createConfigRoutes } from './config.js';
import { createTestConfig } from '../../test/helpers.js';
import type { AgentboardConfig } from '../../types/index.js';

let tmpDir: string;
let configPath: string;
let config: AgentboardConfig;
let app: express.Express;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-config-test-'));
  configPath = path.join(tmpDir, 'config.json');
  config = createTestConfig();
  app = express();
  app.use(express.json());
  app.use('/api/config', createConfigRoutes(config, configPath));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/config', () => {
  it('returns in-memory config when no file exists', async () => {
    // configPath does not exist yet
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.port).toBe(config.port);
    expect(res.body.host).toBe(config.host);
    expect(res.body.maxConcurrentTasks).toBe(config.maxConcurrentTasks);
  });

  it('returns disk config when file exists', async () => {
    const diskConfig: AgentboardConfig = {
      ...config,
      port: 9999,
      host: 'diskhost',
    };
    fs.writeFileSync(configPath, JSON.stringify(diskConfig, null, 2), 'utf-8');

    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.port).toBe(9999);
    expect(res.body.host).toBe('diskhost');
  });
});

describe('PUT /api/config', () => {
  it('merges and persists updates to disk', async () => {
    const res = await request(app)
      .put('/api/config')
      .send({ port: 8888, host: 'updated-host' });

    expect(res.status).toBe(200);
    expect(res.body.port).toBe(8888);
    expect(res.body.host).toBe('updated-host');
    // Other fields should remain from in-memory config
    expect(res.body.maxConcurrentTasks).toBe(config.maxConcurrentTasks);

    // Verify written to disk
    expect(fs.existsSync(configPath)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as AgentboardConfig;
    expect(onDisk.port).toBe(8888);
    expect(onDisk.host).toBe('updated-host');
  });

  it('deep merges modelDefaults', async () => {
    const res = await request(app)
      .put('/api/config')
      .send({ modelDefaults: { planning: 'new-planning-model' } });

    expect(res.status).toBe(200);
    expect(res.body.modelDefaults.planning).toBe('new-planning-model');
    // Other model defaults should still exist
    expect(res.body.modelDefaults.implementation).toBe(config.modelDefaults.implementation);
  });

  it('deep merges commands', async () => {
    const res = await request(app)
      .put('/api/config')
      .send({ commands: { test: 'jest' } });

    expect(res.status).toBe(200);
    expect(res.body.commands.test).toBe('jest');
    // Other commands should still exist
    expect(res.body.commands.lint).toBe(config.commands.lint);
  });

  it('merges updates on top of existing disk config', async () => {
    // First write a config to disk
    const firstWrite = await request(app)
      .put('/api/config')
      .send({ port: 7777 });
    expect(firstWrite.status).toBe(200);

    // Second write should merge on top of the disk version
    const secondWrite = await request(app)
      .put('/api/config')
      .send({ host: 'second-host' });
    expect(secondWrite.status).toBe(200);
    expect(secondWrite.body.port).toBe(7777);
    expect(secondWrite.body.host).toBe('second-host');
  });
});
