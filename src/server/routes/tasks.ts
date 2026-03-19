import { Router } from 'express';
import { spawn } from 'node:child_process';
import type Database from 'better-sqlite3';
import type { Server } from 'socket.io';
import type { TaskStatus } from '../../types/index.js';
import * as queries from '../../db/queries.js';
import { broadcast } from '../ws.js';
import { cleanupWorktree } from '../../worker/git.js';

function parseTaskId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error(`Invalid task ID: ${raw}`), { status: 400 });
  }
  return id;
}

export function createTaskRoutes(db: Database.Database, io: Server): Router {
  const router = Router();

  // GET /api/tasks — list tasks (query params: projectId, status)
  router.get('/', (req, res) => {
    const { projectId, status } = req.query as { projectId?: string; status?: string };
    if (!projectId) {
      res.status(400).json({ error: 'projectId query param is required' });
      return;
    }
    if (status) {
      const tasks = queries.listTasksByStatus(db, projectId, status as TaskStatus);
      res.json(tasks);
    } else {
      const tasks = queries.listTasksByProject(db, projectId);
      res.json(tasks);
    }
  });

  // POST /api/tasks/parse — parse a short description into structured task fields using AI
  router.post('/parse', (req, res) => {
    const { description } = req.body as { description?: string };
    if (!description?.trim()) {
      res.status(400).json({ error: 'description is required' });
      return;
    }

    const prompt = `You are a spec-driven task planner (inspired by spec-kit). Given a short task description, extract structured fields and build a focused specification.

Return ONLY valid JSON with no markdown fences or extra text.

The JSON must have this exact shape:
{
  "title": "short imperative title (max 80 chars)",
  "description": "1-2 sentence expanded description",
  "riskLevel": "low" | "medium" | "high",
  "priority": 0-10 (0=lowest, 10=highest),
  "spec": {
    "goal": "What problem does this solve? Who is affected? What is the desired end state? What is explicitly NOT part of this task?",
    "userScenarios": "P1/P2/P3 prioritized user scenarios in Given/When/Then format. Each scenario should be independently testable and deliver standalone value. One scenario per line.",
    "successCriteria": "Measurable outcomes that define done. Performance targets, business metrics, user satisfaction benchmarks. Each criterion must be independently verifiable."
  }
}

Guidelines:
- riskLevel: "high" for DB migrations, auth changes, infra; "medium" for API changes, refactors; "low" for UI tweaks, docs, tests
- priority: higher for bugs, security fixes, blockers; lower for nice-to-haves, cleanup
- Focus on the WHAT and WHY, not the HOW — no implementation details
- userScenarios should use Given/When/Then format with priority levels (P1 = must-have, P2 = important, P3 = nice-to-have)
- successCriteria should be measurable and verifiable, not vague
- Include scope boundaries in the goal (what this is NOT)
- Leave spec fields as empty strings only if truly not inferable

Task description: ${description.trim()}`;

    const child = spawn('claude', ['--print'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: undefined },
    });

    child.stdin.write(prompt);
    child.stdin.end();

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill();
    }, 60_000);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        console.log(`[http] /api/tasks/parse failed: code=${code} stderr=${stderr} stdout=${stdout}`);
        res.status(500).json({ error: `AI parsing failed: ${stderr || stdout || 'unknown error'}` });
        return;
      }
      // Extract JSON from the response (handle possible markdown fences)
      let jsonStr = stdout.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      }
      try {
        const parsed = JSON.parse(jsonStr);
        res.json(parsed);
      } catch {
        console.log(`[http] /api/tasks/parse JSON parse failed: ${stdout}`);
        res.status(500).json({ error: 'Failed to parse AI response as JSON', raw: stdout });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      res.status(500).json({ error: `Failed to spawn claude: ${err.message}` });
    });
  });

  // POST /api/tasks — create task
  router.post('/', (req, res) => {
    const { projectId, title, description, spec, riskLevel, priority } = req.body as {
      projectId?: string;
      title?: string;
      description?: string;
      spec?: string;
      riskLevel?: string;
      priority?: number;
    };
    if (!projectId || !title) {
      res.status(400).json({ error: 'projectId and title are required' });
      return;
    }
    // If a spec is provided, task is ready to be picked up by the worker
    const initialStatus = spec ? 'ready' : 'backlog';
    const task = queries.createTask(db, {
      projectId,
      title,
      description,
      spec: spec ?? null,
      riskLevel: (riskLevel as queries.CreateTaskData['riskLevel']) ?? 'low',
      priority: priority ?? 0,
      status: initialStatus,
    });
    broadcast(io, 'task:created', task);
    res.status(201).json(task);
  });

  // GET /api/tasks/:id — get task by id
  router.get('/:id', (req, res) => {
    let id: number;
    try { id = parseTaskId(req.params.id); }
    catch { return res.status(400).json({ error: 'Invalid task ID' }); }

    const task = queries.getTaskById(db, id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(task);
  });

  // PUT /api/tasks/:id — update task
  router.put('/:id', (req, res) => {
    let id: number;
    try { id = parseTaskId(req.params.id); }
    catch { return res.status(400).json({ error: 'Invalid task ID' }); }

    const existing = queries.getTaskById(db, id);
    if (!existing) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const { title, description, riskLevel, priority, spec, blockedReason } =
      req.body as Omit<queries.UpdateTaskData, 'status'>;
    const task = queries.updateTask(db, id, {
      title,
      description,
      riskLevel,
      priority,
      spec,
      blockedReason,
    });
    broadcast(io, 'task:updated', task);
    res.json(task);
  });

  // DELETE /api/tasks/:id — delete task
  router.delete('/:id', async (req, res) => {
    let id: number;
    try { id = parseTaskId(req.params.id); }
    catch { return res.status(400).json({ error: 'Invalid task ID' }); }

    const existing = queries.getTaskById(db, id);
    if (!existing) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    // Unclaim if currently claimed
    queries.unclaimTask(db, id);
    // Best-effort worktree cleanup before deleting DB records (cascade)
    await cleanupTaskWorktree(db, id).catch(() => {});
    queries.deleteTask(db, id);
    broadcast(io, 'task:deleted', { id });
    res.json({ ok: true });
  });

  // POST /api/tasks/:id/cancel — cancel a task
  router.post('/:id/cancel', (req, res) => {
    let id: number;
    try { id = parseTaskId(req.params.id); }
    catch { return res.status(400).json({ error: 'Invalid task ID' }); }

    const task = queries.updateTask(db, id, { status: 'cancelled' });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    broadcast(io, 'task:updated', task);
    res.json(task);
  });

  // POST /api/tasks/:id/answer — provide answers to blocked task
  router.post('/:id/answer', (req, res) => {
    let id: number;
    try { id = parseTaskId(req.params.id); }
    catch { return res.status(400).json({ error: 'Invalid task ID' }); }

    const task = queries.getTaskById(db, id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    if (task.status !== 'blocked') {
      res.status(400).json({ error: 'Task is not blocked' });
      return;
    }
    const { answers } = req.body as { answers?: string };
    if (!answers) {
      res.status(400).json({ error: 'answers is required' });
      return;
    }
    // Record the answers as an event
    queries.createEvent(db, {
      taskId: id,
      type: 'answer_provided',
      payload: JSON.stringify({ answers }),
    });

    // Move the task back to ready and clear the blocked reason.
    // TODO(worker): The worker should check event history to determine which
    // stage the task was blocked at and resume from that exact stage instead
    // of starting over from 'ready'. For now we set 'ready' as a pragmatic
    // fallback — the M2 worker loop will implement exact resumption logic.
    const updated = queries.updateTask(db, id, {
      blockedReason: null,
      status: 'ready',
    });
    broadcast(io, 'task:updated', updated);
    res.json(updated);
  });

  // POST /api/tasks/chat — spec-kit specify→clarify conversational loop
  router.post('/chat', (req, res) => {
    const { messages, currentSpec, roundNumber, projectId } = req.body as {
      messages?: Array<{ role: string; content: string }>;
      currentSpec?: Record<string, string>;
      roundNumber?: number;
      projectId?: string;
    };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'messages array is required and must not be empty' });
      return;
    }
    if (!currentSpec || typeof currentSpec !== 'object') {
      res.status(400).json({ error: 'currentSpec object is required' });
      return;
    }

    // Look up project path so Claude runs in the project's repo (picks up CLAUDE.md automatically)
    let projectPath: string | undefined;
    if (projectId) {
      const project = queries.getProjectById(db, projectId);
      if (project) {
        projectPath = project.path;
      }
    }

    const round = roundNumber ?? 1;

    const specState = [
      `Title: ${currentSpec.title || '(empty)'}`,
      `Description: ${currentSpec.description || '(empty)'}`,
      `Goal: ${currentSpec.goal || '(empty)'}`,
      `User Scenarios: ${currentSpec.userScenarios || '(empty)'}`,
      `Success Criteria: ${currentSpec.successCriteria || '(empty)'}`,
    ].join('\n');

    const conversationHistory = messages
      .slice(-10)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    // Round 1: spec-kit SPECIFY phase — generate initial draft with clarification markers
    // Round 2+: spec-kit CLARIFY phase — ask one question at a time, update spec incrementally
    const prompt = round === 1
      ? `You are a spec-driven specification agent (following GitHub's spec-kit methodology).

Given a feature description from a product manager, create an initial specification draft.
You are running inside the project's repository — use the project's CLAUDE.md, AGENTS.md, and codebase context to make your spec and questions highly relevant to this specific project.

CRITICAL RULES:
- Focus on WHAT users need and WHY. Avoid HOW to implement (no tech stack, APIs, code structure).
- Only fill spec fields with information the user EXPLICITLY stated. Do NOT infer or guess.
- For unclear or missing aspects, add [NEEDS CLARIFICATION] markers in the goal field.
- Maximum 3 [NEEDS CLARIFICATION] markers. Only for decisions that significantly impact scope or UX.
- Make informed guesses for minor details and document them as assumptions.
- User scenarios MUST use Given/When/Then format with P1/P2/P3 priority levels.
- Each user scenario should be independently testable and deliver standalone value.
- Success criteria must be measurable, technology-agnostic, and verifiable.

After generating the draft spec, you MUST ask 2-3 clarifying questions about the most critical gaps.
Present each question with:
- Context: what part of the spec this affects
- Recommended answer based on best practices
- 2-3 options as a simple list

Feature description from user:
${conversationHistory}

Return ONLY valid JSON with no markdown fences:
{
  "message": "Your response: summarize what you understood, then ask 2-3 clarifying questions with recommended answers and options",
  "specUpdates": {
    "goal": "What was explicitly stated about the problem and desired end state. Include [NEEDS CLARIFICATION: question] markers for critical unknowns.",
    "userScenarios": "Only scenarios clearly implied by the description. Leave empty if not enough info.",
    "successCriteria": "Only criteria explicitly stated or clearly implied. Leave empty if not enough info."
  },
  "titleUpdate": "short imperative title",
  "descriptionUpdate": "1-2 sentence description",
  "riskLevelUpdate": "low|medium|high",
  "priorityUpdate": 0,
  "isComplete": false,
  "gaps": ["critical gap 1", "critical gap 2"]
}`
      : `You are a spec clarification agent (following GitHub's spec-kit clarify methodology).

You are in round ${round} of a specification clarification session. Your goal is to reduce ambiguity and fill gaps in the spec through targeted questions.
You are running inside the project's repository — use the project's CLAUDE.md, AGENTS.md, and codebase context to ask questions specific to this project.

Current spec state:
${specState}

Conversation so far:
${conversationHistory}

CLARIFICATION RULES:
1. Based on the user's latest answer, update the relevant spec fields. Remove any [NEEDS CLARIFICATION] markers that are now resolved.
2. Perform a structured ambiguity scan across these categories:
   - Functional scope & behavior (user goals, out-of-scope declarations)
   - User roles & personas
   - Edge cases & error handling
   - Non-functional attributes (performance, security, scalability)
   - Success criteria completeness
3. Ask EXACTLY ONE follow-up question at a time. Present it with:
   - **Context**: What part of the spec this affects
   - **Recommended**: Your suggested answer with brief reasoning
   - **Options**: 2-4 concrete options (A/B/C/D) the user can pick from, or "provide your own"
4. Focus on questions whose answers materially impact scope, user experience, or test design.
5. Do NOT ask about implementation details, tech stack, or architecture.
6. User scenarios should use Given/When/Then format with P1/P2/P3 priorities.
7. Success criteria must be measurable and technology-agnostic.
8. You may also update title, description, riskLevel, priority if the conversation reveals better values.
9. Set isComplete to true ONLY when:
   - All 3 spec fields have substantive content
   - No [NEEDS CLARIFICATION] markers remain
   - You have asked at least 3 questions total across all rounds
   - You have no remaining high-impact concerns
10. If the user says "done", "good enough", "proceed", or similar, set isComplete to true regardless of round.

Return ONLY valid JSON with no markdown fences:
{
  "message": "Your response: acknowledge the answer, update context, then ask ONE focused question with recommended answer and options",
  "specUpdates": { "goal": "...", "userScenarios": "...", "successCriteria": "..." },
  "titleUpdate": "updated title if changed, omit if not",
  "descriptionUpdate": "updated description if changed, omit if not",
  "riskLevelUpdate": "low|medium|high if changed, omit if not",
  "priorityUpdate": 0,
  "isComplete": false,
  "gaps": ["remaining gap 1"]
}`;

    const spawnOpts: { stdio: ['pipe', 'pipe', 'pipe']; env: Record<string, string | undefined>; cwd?: string } = {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: undefined },
    };
    if (projectPath) {
      spawnOpts.cwd = projectPath;
      console.log(`[http] /api/tasks/chat spawning claude in project dir: ${projectPath}`);
    } else {
      console.log(`[http] /api/tasks/chat WARNING: no projectPath resolved (projectId=${projectId ?? 'none'})`);
    }

    const child = spawn('claude', ['--print'], spawnOpts);

    child.stdin.write(prompt);
    child.stdin.end();

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => { child.kill(); }, 60_000);

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        console.log(`[http] /api/tasks/chat failed: code=${code} stderr=${stderr}`);
        res.status(500).json({ error: `AI chat failed: ${stderr || stdout || 'unknown error'}` });
        return;
      }
      let jsonStr = stdout.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) { jsonStr = fenceMatch[1].trim(); }
      try {
        const parsed = JSON.parse(jsonStr) as {
          message: string;
          specUpdates?: Record<string, string>;
          titleUpdate?: string;
          descriptionUpdate?: string;
          riskLevelUpdate?: string;
          priorityUpdate?: number;
          isComplete?: boolean;
          gaps?: string[];
        };
        res.json({
          message: typeof parsed.message === 'string' ? parsed.message : 'I updated the spec based on your input.',
          specUpdates: parsed.specUpdates && typeof parsed.specUpdates === 'object' ? parsed.specUpdates : {},
          titleUpdate: typeof parsed.titleUpdate === 'string' ? parsed.titleUpdate : undefined,
          descriptionUpdate: typeof parsed.descriptionUpdate === 'string' ? parsed.descriptionUpdate : undefined,
          riskLevelUpdate: typeof parsed.riskLevelUpdate === 'string' ? parsed.riskLevelUpdate : undefined,
          priorityUpdate: typeof parsed.priorityUpdate === 'number' ? parsed.priorityUpdate : undefined,
          isComplete: !!parsed.isComplete,
          gaps: Array.isArray(parsed.gaps) ? parsed.gaps.filter((g): g is string => typeof g === 'string') : [],
        });
      } catch {
        console.log(`[http] /api/tasks/chat JSON parse failed: ${stdout}`);
        res.status(500).json({ error: 'Failed to parse AI response', raw: stdout });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      res.status(500).json({ error: `Failed to spawn claude: ${err.message}` });
    });
  });

  // POST /api/tasks/:id/review-plan — engineer approves or rejects AI-generated plan
  router.post('/:id/review-plan', (req, res) => {
    let id: number;
    try { id = parseTaskId(req.params.id); }
    catch { return res.status(400).json({ error: 'Invalid task ID' }); }

    const task = queries.getTaskById(db, id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    if (task.status !== 'needs_plan_review') {
      res.status(400).json({ error: 'Task is not awaiting plan review' });
      return;
    }

    const { action, reason, edits } = req.body as {
      action?: 'approve' | 'reject';
      reason?: string;
      edits?: { planSummary?: string; steps?: Array<{ title: string; description: string }> };
    };

    if (action !== 'approve' && action !== 'reject') {
      res.status(400).json({ error: 'action must be "approve" or "reject"' });
      return;
    }

    if (action === 'reject') {
      if (!reason?.trim()) {
        res.status(400).json({ error: 'reason is required when rejecting a plan' });
        return;
      }
      // Store rejection as event for context in next planning run
      queries.createEvent(db, {
        taskId: task.id,
        type: 'plan_review_rejected',
        payload: JSON.stringify({ reason: reason.trim() }),
      });
      // Move back to ready — worker will re-run planning with rejection feedback
      const updated = queries.updateTask(db, task.id, { status: 'ready' });
      broadcast(io, 'task:updated', updated);
      res.json(updated);
      return;
    }

    // Approve: store edits if provided, then move to ready for implementation
    if (edits) {
      queries.createEvent(db, {
        taskId: task.id,
        type: 'plan_review_approved',
        payload: JSON.stringify({ edits }),
      });
    } else {
      queries.createEvent(db, {
        taskId: task.id,
        type: 'plan_review_approved',
        payload: JSON.stringify({}),
      });
    }

    // Move to ready — worker will detect existing planning run and skip to implementation
    const updated = queries.updateTask(db, task.id, { status: 'ready' });
    broadcast(io, 'task:updated', updated);
    res.json(updated);
  });

  // POST /api/tasks/:id/retry — retry a failed/blocked task
  router.post('/:id/retry', async (req, res) => {
    let id: number;
    try { id = parseTaskId(req.params.id); }
    catch { return res.status(400).json({ error: 'Invalid task ID' }); }

    const task = queries.getTaskById(db, id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (task.status !== 'failed' && task.status !== 'blocked') {
      res.status(400).json({ error: 'Task must be in failed or blocked state to retry' });
      return;
    }

    // Clean up worktree and git refs
    await cleanupTaskWorktree(db, id);
    const oldRefs = queries.listGitRefsByTask(db, id);
    for (const ref of oldRefs) {
      queries.deleteGitRef(db, ref.id);
    }

    const updated = queries.updateTask(db, id, {
      status: 'ready',
      blockedReason: null,
    });
    broadcast(io, 'task:updated', updated);
    res.json(updated);
  });

  // POST /api/tasks/:id/unclaim — force-unclaim a stale task
  router.post('/:id/unclaim', (req, res) => {
    let id: number;
    try { id = parseTaskId(req.params.id); }
    catch { return res.status(400).json({ error: 'Invalid task ID' }); }

    const task = queries.getTaskById(db, id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    if (!task.claimedBy) {
      res.status(400).json({ error: 'Task is not claimed' });
      return;
    }
    queries.unclaimTask(db, id);
    const updated = queries.getTaskById(db, id)!;
    broadcast(io, 'task:updated', updated);
    res.json(updated);
  });

  // GET /api/tasks/:id/delete-impact — preview what happens if a task is deleted
  router.get('/:id/delete-impact', (req, res) => {
    let id: number;
    try { id = parseTaskId(req.params.id); }
    catch { return res.status(400).json({ error: 'Invalid task ID' }); }

    const task = queries.getTaskById(db, id);
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

    const impact: Record<string, unknown> = {
      taskId: id,
    };

    res.json(impact);
  });

  /**
   * Best-effort cleanup of a task's git worktree and update git ref status.
   */
  async function cleanupTaskWorktree(database: Database.Database, taskId: number): Promise<void> {
    const gitRefs = queries.listGitRefsByTask(database, taskId);
    if (gitRefs.length === 0) return;

    const ref = gitRefs[0];
    if (!ref.worktreePath) return;

    // Find the project to get the repo path
    const task = queries.getTaskById(database, taskId);
    if (!task) return;

    const projects = queries.listProjects(database);
    const project = projects.find((p) => p.id === task.projectId);
    if (!project) return;

    try {
      await cleanupWorktree(project.path, ref.worktreePath, ref.branch);
      queries.updateGitRef(database, ref.id, { worktreePath: null });
    } catch {
      // Best effort — worktree may already be gone
    }
  }

  return router;
}
