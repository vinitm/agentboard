import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { Server } from 'socket.io';
import type { RiskLevel } from '../../types/index.js';
import * as queries from '../../db/queries.js';
import { broadcast } from '../ws.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const promptsDir = path.resolve(currentDir, '..', '..', '..', '..', 'prompts');

// Load system prompt once at module init
const systemPrompt = fs.readFileSync(
  path.join(promptsDir, 'brainstorming-system.md'),
  'utf-8'
);

// Concurrency guard: one in-flight chat request per task
const inFlightTasks = new Set<string>();

interface SSEChunkEvent {
  type: 'chunk';
  content: string;
}

interface SSEDoneEvent {
  type: 'done';
  message: string;
  specUpdates: Record<string, string>;
  titleUpdate: string | null;
  descriptionUpdate: string | null;
  riskLevelUpdate: RiskLevel | null;
  isComplete: boolean;
}

type SSEEvent = SSEChunkEvent | SSEDoneEvent;

function sendSSE(res: import('express').Response, event: SSEEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function createChatRoutes(db: Database.Database, io: Server): Router {
  const router = Router();

  // GET /api/tasks/:id/chat/messages — retrieve persisted chat history
  router.get('/:id/chat/messages', (req, res) => {
    const task = queries.getTaskById(db, req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const messages = queries.listChatMessagesByTask(db, task.id);
    res.json(messages);
  });

  // POST /api/tasks/:id/chat/stream — SSE streaming chat endpoint
  router.post('/:id/chat/stream', (req, res) => {
    const task = queries.getTaskById(db, req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const { message } = req.body as { message?: string };
    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required and must be non-empty' });
      return;
    }

    // Concurrency guard
    if (inFlightTasks.has(task.id)) {
      res.status(409).json({ error: 'A chat request is already in progress for this task' });
      return;
    }
    inFlightTasks.add(task.id);

    // Persist user message
    queries.createChatMessage(db, {
      taskId: task.id,
      role: 'user',
      content: message.trim(),
    });

    // Look up project for cwd
    const project = queries.getProjectById(db, task.projectId);
    const projectPath = project?.path;

    // Determine first vs subsequent message
    const isFirstMessage = !task.chatSessionId;
    const sessionId = task.chatSessionId ?? uuidv4();

    // Save session ID on first message
    if (isFirstMessage) {
      queries.updateTask(db, task.id, { chatSessionId: sessionId });
    }

    // Build spawn args
    const args = buildSpawnArgs(isFirstMessage, sessionId);

    // Build stdin content
    const stdinContent = buildStdinContent(isFirstMessage, task, message.trim());

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Spawn claude process
    const spawnOpts = {
      stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: undefined },
      cwd: projectPath ?? undefined,
    };

    console.log(`[http] /api/tasks/${task.id}/chat/stream spawning claude (${isFirstMessage ? 'new session' : 'resume'}: ${sessionId})`);
    const child = spawn('claude', args, spawnOpts);

    // Write prompt via stdin then close
    child.stdin.write(stdinContent);
    child.stdin.end();

    const streamState: StreamState = { fullText: '', resumeFailed: false, resumeError: '' };
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill();
    }, 120_000);

    // Parse stream-json stdout line by line
    let lineBuffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          handleStreamEvent(event, res, io, task.id, streamState);
        } catch {
          // Skip malformed JSON lines
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Handle client disconnect
    res.on('close', () => {
      clearTimeout(timer);
      child.kill();
      inFlightTasks.delete(task.id);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      inFlightTasks.delete(task.id);

      // Process any remaining buffered line
      if (lineBuffer.trim()) {
        try {
          const event = JSON.parse(lineBuffer) as Record<string, unknown>;
          handleStreamEvent(event, res, io, task.id, streamState);
        } catch {
          // ignore
        }
      }

      // Handle resume failure — fallback to fresh session with history replay
      if (streamState.resumeFailed) {
        console.log(`[http] /api/tasks/${task.id}/chat/stream resume failed: ${streamState.resumeError}, falling back to fresh session`);
        spawnFallbackSession(db, io, task, message.trim(), projectPath, res);
        return;
      }

      if (code !== 0 && !streamState.fullText) {
        console.log(`[http] /api/tasks/${task.id}/chat/stream failed: code=${code} stderr=${stderr}`);
        sendSSE(res, {
          type: 'done',
          message: `AI chat failed: ${stderr || 'unknown error'}`,
          specUpdates: {},
          titleUpdate: null,
          descriptionUpdate: null,
          riskLevelUpdate: null,
          isComplete: false,
        });
        res.end();
        return;
      }

      // Parse the full response text for the JSON block
      const parsed = parseResponseJson(streamState.fullText);
      const messageText = extractMessageText(streamState.fullText, parsed.message);

      // Persist assistant message
      queries.createChatMessage(db, {
        taskId: task.id,
        role: 'assistant',
        content: messageText,
      });

      // Persist spec & meta updates
      const taskUpdate: Parameters<typeof queries.updateTask>[2] = {};
      if (Object.keys(parsed.specUpdates).length > 0) {
        const existingSpec = parseSpecJson(task.spec);
        for (const [key, val] of Object.entries(parsed.specUpdates)) {
          if (typeof val === 'string' && (val.trim().length > 0 || !existingSpec[key]?.trim())) {
            existingSpec[key] = val;
          }
        }
        taskUpdate.spec = JSON.stringify(existingSpec);
      }
      if (parsed.titleUpdate) taskUpdate.title = parsed.titleUpdate;
      if (parsed.descriptionUpdate) taskUpdate.description = parsed.descriptionUpdate;
      if (parsed.riskLevelUpdate) taskUpdate.riskLevel = parsed.riskLevelUpdate;

      if (Object.keys(taskUpdate).length > 0) {
        queries.updateTask(db, task.id, taskUpdate);
      }

      // Send final SSE event
      sendSSE(res, {
        type: 'done',
        message: messageText,
        specUpdates: parsed.specUpdates,
        titleUpdate: parsed.titleUpdate,
        descriptionUpdate: parsed.descriptionUpdate,
        riskLevelUpdate: parsed.riskLevelUpdate,
        isComplete: parsed.isComplete,
      });

      res.end();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      inFlightTasks.delete(task.id);
      console.log(`[http] /api/tasks/${task.id}/chat/stream spawn error: ${err.message}`);
      sendSSE(res, {
        type: 'done',
        message: `Failed to spawn claude: ${err.message}`,
        specUpdates: {},
        titleUpdate: null,
        descriptionUpdate: null,
        riskLevelUpdate: null,
        isComplete: false,
      });
      res.end();
    });
  });

  return router;
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildSpawnArgs(isFirstMessage: boolean, sessionId: string): string[] {
  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];

  if (isFirstMessage) {
    args.push('--system-prompt', systemPrompt);
    args.push('--session-id', sessionId);
  } else {
    args.push('--resume', sessionId);
  }

  return args;
}

function buildStdinContent(
  isFirstMessage: boolean,
  task: { title: string; description: string; spec: string | null },
  message: string
): string {
  if (isFirstMessage) {
    const specContext = [
      '## Current Spec State',
      `Title: ${task.title || '(empty)'}`,
      `Description: ${task.description || '(empty)'}`,
      `Goal: ${getSpecField(task.spec, 'goal')}`,
      `User Scenarios: ${getSpecField(task.spec, 'userScenarios')}`,
      `Success Criteria: ${getSpecField(task.spec, 'successCriteria')}`,
      '',
      '## PM Message',
      message,
    ].join('\n');
    return specContext;
  }
  return message;
}

/** Tracks stream state including whether a resume failure was detected */
interface StreamState {
  fullText: string;
  resumeFailed: boolean;
  resumeError: string;
}

function handleStreamEvent(
  event: Record<string, unknown>,
  res: import('express').Response,
  io: Server,
  taskId: string,
  state: StreamState
): void {
  const eventType = event.type as string;

  if (eventType === 'system') return; // Skip system/hook events

  if (eventType === 'stream_event') {
    // Extract text delta from partial message — stream to browser
    const innerEvent = event.event as Record<string, unknown> | undefined;
    const delta = innerEvent?.delta as Record<string, unknown> | undefined;
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      sendSSE(res, { type: 'chunk', content: delta.text });
      broadcast(io, 'task:chat', { taskId, chunk: delta.text });
      // Don't accumulate — result event has authoritative text
    }
    return;
  }

  // Skip assistant event — it duplicates stream_event content.
  // The result event's `result` field is the authoritative full text.
  if (eventType === 'assistant') return;

  if (eventType === 'result') {
    const subtype = event.subtype as string;

    // Check for resume failure
    if (subtype === 'error_during_execution') {
      const errors = event.errors as string[] | undefined;
      const isResumeFail = errors?.some((e) => e.includes('No conversation found'));
      if (isResumeFail) {
        state.resumeFailed = true;
        state.resumeError = errors?.join('; ') ?? 'Resume failed';
      }
      return;
    }

    // Use result field as authoritative full text
    const resultText = event.result as string | undefined;
    if (typeof resultText === 'string') {
      state.fullText = resultText;
    }
    return;
  }
}

/**
 * Fallback: when --resume fails ("No conversation found"), generate a new session
 * and replay chat history from DB as context in the first message.
 */
function spawnFallbackSession(
  db: Database.Database,
  io: Server,
  task: { id: string; projectId: string; title: string; description: string; spec: string | null },
  currentMessage: string,
  projectPath: string | undefined,
  res: import('express').Response
): void {
  const newSessionId = uuidv4();
  queries.updateTask(db, task.id, { chatSessionId: newSessionId });

  // Build context from DB history
  const chatHistory = queries.listChatMessagesByTask(db, task.id);
  // Exclude the current user message (already at the end) from history
  const historyMessages = chatHistory.slice(0, -1);
  const historyText = historyMessages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const specContext = [
    '## Current Spec State',
    `Title: ${task.title || '(empty)'}`,
    `Description: ${task.description || '(empty)'}`,
    `Goal: ${getSpecField(task.spec, 'goal')}`,
    `User Scenarios: ${getSpecField(task.spec, 'userScenarios')}`,
    `Success Criteria: ${getSpecField(task.spec, 'successCriteria')}`,
  ].join('\n');

  const stdinContent = historyText
    ? `${specContext}\n\n## Previous Conversation\n\n${historyText}\n\n## New Message\n\n${currentMessage}`
    : `${specContext}\n\n## PM Message\n\n${currentMessage}`;

  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--system-prompt', systemPrompt,
    '--session-id', newSessionId,
  ];

  console.log(`[http] /api/tasks/${task.id}/chat/stream fallback: new session ${newSessionId}`);

  const fallbackState: StreamState = { fullText: '', resumeFailed: false, resumeError: '' };

  const child = spawn('claude', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CLAUDECODE: undefined },
    cwd: projectPath ?? undefined,
  });

  child.stdin.write(stdinContent);
  child.stdin.end();

  const fallbackTimer = setTimeout(() => { child.kill(); }, 120_000);

  let fallbackLineBuffer = '';
  child.stdout.on('data', (chunk: Buffer) => {
    fallbackLineBuffer += chunk.toString();
    const lines = fallbackLineBuffer.split('\n');
    fallbackLineBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        handleStreamEvent(event, res, io, task.id, fallbackState);
      } catch { /* skip */ }
    }
  });

  child.on('close', () => {
    clearTimeout(fallbackTimer);
    // Process remaining buffer
    if (fallbackLineBuffer.trim()) {
      try {
        const event = JSON.parse(fallbackLineBuffer) as Record<string, unknown>;
        handleStreamEvent(event, res, io, task.id, fallbackState);
      } catch { /* ignore */ }
    }

    const parsed = parseResponseJson(fallbackState.fullText);
    const messageText = extractMessageText(fallbackState.fullText, parsed.message);

    queries.createChatMessage(db, { taskId: task.id, role: 'assistant', content: messageText });

    const taskUpdate: Parameters<typeof queries.updateTask>[2] = {};
    if (Object.keys(parsed.specUpdates).length > 0) {
      const existingSpec = parseSpecJson(task.spec);
      for (const [key, val] of Object.entries(parsed.specUpdates)) {
        if (typeof val === 'string' && (val.trim().length > 0 || !existingSpec[key]?.trim())) {
          existingSpec[key] = val;
        }
      }
      taskUpdate.spec = JSON.stringify(existingSpec);
    }
    if (parsed.titleUpdate) taskUpdate.title = parsed.titleUpdate;
    if (parsed.descriptionUpdate) taskUpdate.description = parsed.descriptionUpdate;
    if (parsed.riskLevelUpdate) taskUpdate.riskLevel = parsed.riskLevelUpdate;
    if (Object.keys(taskUpdate).length > 0) queries.updateTask(db, task.id, taskUpdate);

    sendSSE(res, {
      type: 'done',
      message: messageText,
      specUpdates: parsed.specUpdates,
      titleUpdate: parsed.titleUpdate,
      descriptionUpdate: parsed.descriptionUpdate,
      riskLevelUpdate: parsed.riskLevelUpdate,
      isComplete: parsed.isComplete,
    });
    res.end();
  });

  child.on('error', (err) => {
    clearTimeout(fallbackTimer);
    sendSSE(res, {
      type: 'done',
      message: `Fallback session failed: ${err.message}`,
      specUpdates: {},
      titleUpdate: null,
      descriptionUpdate: null,
      riskLevelUpdate: null,
      isComplete: false,
    });
    res.end();
  });
}

function getSpecField(spec: string | null, field: string): string {
  if (!spec) return '(empty)';
  try {
    const parsed = JSON.parse(spec) as Record<string, unknown>;
    const value = parsed[field];
    return typeof value === 'string' && value.trim() ? value : '(empty)';
  } catch {
    return '(empty)';
  }
}

interface ParsedResponse {
  message: string;
  specUpdates: Record<string, string>;
  titleUpdate: string | null;
  descriptionUpdate: string | null;
  riskLevelUpdate: RiskLevel | null;
  isComplete: boolean;
}

function parseResponseJson(fullOutput: string): ParsedResponse {
  const defaults: ParsedResponse = {
    message: '',
    specUpdates: {},
    titleUpdate: null,
    descriptionUpdate: null,
    riskLevelUpdate: null,
    isComplete: false,
  };

  const fenceMatch = fullOutput.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (!fenceMatch) return defaults;

  try {
    const parsed = JSON.parse(fenceMatch[1].trim()) as Record<string, unknown>;

    const specUpdates: Record<string, string> = {};
    if (parsed.specUpdates && typeof parsed.specUpdates === 'object') {
      for (const [key, val] of Object.entries(parsed.specUpdates as Record<string, unknown>)) {
        if (typeof val === 'string') {
          specUpdates[key] = val;
        }
      }
    }

    const validRiskLevels: RiskLevel[] = ['low', 'medium', 'high'];
    const riskLevelRaw = typeof parsed.riskLevelUpdate === 'string' ? parsed.riskLevelUpdate : null;
    const riskLevel = riskLevelRaw && validRiskLevels.includes(riskLevelRaw as RiskLevel)
      ? (riskLevelRaw as RiskLevel)
      : null;

    return {
      message: typeof parsed.message === 'string' ? parsed.message : '',
      specUpdates,
      titleUpdate: typeof parsed.titleUpdate === 'string' ? parsed.titleUpdate : null,
      descriptionUpdate: typeof parsed.descriptionUpdate === 'string' ? parsed.descriptionUpdate : null,
      riskLevelUpdate: riskLevel,
      isComplete: !!parsed.isComplete,
    };
  } catch {
    return defaults;
  }
}

function parseSpecJson(spec: string | null): Record<string, string> {
  if (!spec) return {};
  try {
    return JSON.parse(spec) as Record<string, string>;
  } catch {
    return {};
  }
}

function extractMessageText(fullOutput: string, parsedMessage: string): string {
  const fenceStart = fullOutput.indexOf('```json');
  const altFenceStart = fullOutput.indexOf('```\n{');
  const cutPoint = fenceStart >= 0 ? fenceStart : altFenceStart;

  if (cutPoint > 0) {
    const textBefore = fullOutput.substring(0, cutPoint).trim();
    if (textBefore.length > 0) return textBefore;
  }

  if (parsedMessage) return parsedMessage;
  return fullOutput.trim();
}
