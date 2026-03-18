import { Router } from 'express';
import type Database from 'better-sqlite3';
import { getTaskById } from '../../db/queries.js';
import {
  getTaskCostRollup,
  getStageCostBreakdown,
  getCostTrend,
} from '../../db/stage-log-queries.js';

// Default: Opus pricing ($15 / 1M input, $75 / 1M output).
// We track combined tokens, so use a blended estimate.
const DEFAULT_COST_PER_MILLION_TOKENS = 30;

function parseTaskId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error(`Invalid task ID: ${raw}`), { status: 400 });
  }
  return id;
}

function tokensToDollars(tokens: number, costPerMillion: number): number {
  return Math.round((tokens / 1_000_000) * costPerMillion * 100) / 100;
}

export function createCostRoutes(db: Database.Database): Router {
  const router = Router({ mergeParams: true });

  // GET /api/tasks/:id/costs — cost rollup for a single task
  router.get('/tasks/:id/costs', (req, res) => {
    let id: number;
    try { id = parseTaskId(req.params.id); }
    catch { return res.status(400).json({ error: 'Invalid task ID' }); }

    const task = getTaskById(db, id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const costPerMillion = Number(req.query.costPerMillion) || DEFAULT_COST_PER_MILLION_TOKENS;
    const rollup = getTaskCostRollup(db, id);

    res.json({
      ...rollup,
      estimatedCost: tokensToDollars(rollup.totalTokens, costPerMillion),
      costPerMillion,
      stages: rollup.stages.map(s => ({
        ...s,
        estimatedCost: tokensToDollars(s.tokens, costPerMillion),
      })),
    });
  });

  // GET /api/projects/:projectId/costs/breakdown — per-stage cost breakdown
  router.get('/projects/:projectId/costs/breakdown', (req, res) => {
    const { projectId } = req.params;
    const costPerMillion = Number(req.query.costPerMillion) || DEFAULT_COST_PER_MILLION_TOKENS;
    const breakdown = getStageCostBreakdown(db, projectId);

    const totalTokens = breakdown.reduce((sum, s) => sum + s.totalTokens, 0);

    res.json({
      projectId,
      costPerMillion,
      totalTokens,
      estimatedTotalCost: tokensToDollars(totalTokens, costPerMillion),
      stages: breakdown.map(s => ({
        ...s,
        estimatedCost: tokensToDollars(s.totalTokens, costPerMillion),
        percentage: totalTokens > 0 ? Math.round((s.totalTokens / totalTokens) * 100) : 0,
      })),
    });
  });

  // GET /api/projects/:projectId/costs/trend — daily cost trend
  router.get('/projects/:projectId/costs/trend', (req, res) => {
    const { projectId } = req.params;
    const days = Math.min(Number(req.query.days) || 30, 365);
    const costPerMillion = Number(req.query.costPerMillion) || DEFAULT_COST_PER_MILLION_TOKENS;
    const trend = getCostTrend(db, projectId, days);

    res.json({
      projectId,
      days,
      costPerMillion,
      points: trend.map(p => ({
        ...p,
        estimatedCost: tokensToDollars(p.totalTokens, costPerMillion),
      })),
    });
  });

  return router;
}
