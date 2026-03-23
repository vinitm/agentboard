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

// Lazy-load system prompt (deferred so module can be imported in test environments
// where the prompts directory may not exist at the expected relative path)
let _systemPrompt: string | null = null;
function getSystemPrompt(): string {
  if (_systemPrompt === null) {
    _systemPrompt = fs.readFileSync(
      path.join(promptsDir, 'brainstorming-system.md'),
      'utf-8'
    );
  }
  return _systemPrompt;
}

// Concurrency guard: one in-flight chat request per task
const inFlightTasks = new Set<number>();

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

function parseTaskId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error(`Invalid task ID: ${raw}`), { status: 400 });
  }
  return id;
}

export function createChatRoutes(db: Database.Database, io: Server): Router {
  const router = Router();

  // GET /api/tasks/:id/chat/messages — retrieve persisted chat history
  router.get('/:id/chat/messages', (req, res) => {
    let id: number;
    try { id = parseTaskId(req.params.id); }
    catch { return res.status(400).json({ error: 'Invalid task ID' }); }

    const task = queries.getTaskById(db, id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const messages = queries.listChatMessagesByTask(db, task.id);
    res.json(messages);
  });

  // POST /api/tasks/:id/chat/stream — SSE streaming chat endpoint
  router.post('/:id/chat/stream', (req, res) => {
    let id: number;
    try { id = parseTaskId(req.params.id); }
    catch { return res.status(400).json({ error: 'Invalid task ID' }); }

    const task = queries.getTaskById(db, id);
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

    const streamState: StreamState = { fullText: '', streamedText: '', resumeFailed: false, resumeError: '' };
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

    // Handle client disconnect — kill child but let child.on('close') save partial progress
    let clientDisconnected = false;
    res.on('close', () => {
      clientDisconnected = true;
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

      // Use result text if available, otherwise fall back to accumulated stream text
      const responseText = streamState.fullText || streamState.streamedText;

      if (code !== 0 && !responseText) {
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
      const parsed = parseResponseJson(responseText);
      const messageText = extractMessageText(responseText, parsed.message);

      // Detect missing JSON block — covers both truncation AND role violations.
      // When the bot implements instead of speccing, it also skips the JSON block.
      const hasJsonBlock = Object.keys(parsed.specUpdates).length > 0 || parsed.isComplete;

      if (messageText.trim() && !hasJsonBlock) {
        // Response had no JSON block. Could be truncation or the agent going off-script.
        // Save the raw message, then spawn a corrective follow-up to recover spec fields.
        // Runs even when client disconnected — spec recovery is server-side.
        console.log(`[http] /api/tasks/${task.id}/chat/stream missing JSON block, sending corrective follow-up`);

        queries.createChatMessage(db, {
          taskId: task.id,
          role: 'assistant',
          content: messageText,
        });

        const correctionPrompt = [
          'STOP. Your previous response is missing the required JSON block.',
          'You are a SPEC BUILDER. Do NOT write code, implement, or suggest file changes.',
          'Emit ONLY the JSON block below — no other text, no explanation, no code.',
          'Fill all spec fields based on what has been discussed. Leave "" for fields not yet covered.',
          'If the user asked to implement, build, ship, or is done — set isComplete to true.',
          '',
          '```json',
          '{"specUpdates":{"goal":"...","userScenarios":"...","successCriteria":"..."},"titleUpdate":"...","descriptionUpdate":"...","riskLevelUpdate":"low","isComplete":false}',
          '```',
        ].join('\n');

        spawnCorrectionFollowup(db, io, task, correctionPrompt, sessionId, projectPath, res);
        return;
      }

      // Persist assistant message (even partial — saves progress on disconnect)
      if (messageText.trim()) {
        const isPartial = clientDisconnected && !streamState.fullText;
        if (isPartial) {
          console.log(`[http] /api/tasks/${task.id}/chat/stream saving partial response (${messageText.length} chars)`);
        }
        queries.createChatMessage(db, {
          taskId: task.id,
          role: 'assistant',
          content: messageText,
        });
      }

      // Persist spec & meta updates
      persistSpecUpdates(db, io, task, parsed);

      // Only send SSE if client is still connected
      if (!clientDisconnected) {
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
      }
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
    // Guardrails: read-only tools, no writes/edits/bash
    '--tools', 'Read,Glob,Grep',
  ];

  if (isFirstMessage) {
    args.push('--system-prompt', getSystemPrompt());
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
  /** Accumulated text_delta chunks — used as fallback when process is killed before result event */
  streamedText: string;
  resumeFailed: boolean;
  resumeError: string;
}

function handleStreamEvent(
  event: Record<string, unknown>,
  res: import('express').Response,
  io: Server,
  taskId: number,
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
      // Accumulate as fallback for when process is killed before result event
      state.streamedText += delta.text;
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
  task: { id: number; projectId: string; title: string; description: string; spec: string | null },
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
    '--tools', 'Read,Glob,Grep',
    '--system-prompt', getSystemPrompt(),
    '--session-id', newSessionId,
  ];

  console.log(`[http] /api/tasks/${task.id}/chat/stream fallback: new session ${newSessionId}`);

  const fallbackState: StreamState = { fullText: '', streamedText: '', resumeFailed: false, resumeError: '' };

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

    const fallbackResponseText = fallbackState.fullText || fallbackState.streamedText;
    const parsed = parseResponseJson(fallbackResponseText);
    const messageText = extractMessageText(fallbackResponseText, parsed.message);

    if (messageText.trim()) {
      queries.createChatMessage(db, { taskId: task.id, role: 'assistant', content: messageText });
    }

    persistSpecUpdates(db, io, task, parsed);

    if (!res.writableEnded) {
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
    }
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

  // Try fenced JSON first (```json ... ```)
  const fenceMatch = fullOutput.match(/```(?:json)?\s*([\s\S]*?)```/);
  // Fall back to last JSON object in the output (unfenced)
  let jsonStr: string | null = fenceMatch?.[1]?.trim() ?? null;
  if (!jsonStr) {
    // Find last { ... } block that looks like our response JSON
    const lastBrace = fullOutput.lastIndexOf('}');
    if (lastBrace >= 0) {
      // Walk backwards to find the matching opening brace
      let depth = 0;
      for (let i = lastBrace; i >= 0; i--) {
        if (fullOutput[i] === '}') depth++;
        else if (fullOutput[i] === '{') depth--;
        if (depth === 0) {
          const candidate = fullOutput.slice(i, lastBrace + 1);
          // Only accept if it has specUpdates or isComplete — not just any random JSON
          if (candidate.includes('specUpdates') || candidate.includes('isComplete')) {
            jsonStr = candidate;
          }
          break;
        }
      }
    }
  }
  if (!jsonStr) return defaults;

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

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
  // Find and remove ONLY the spec-update JSON block (contains specUpdates/isComplete),
  // preserving conversational code examples and text after the block.
  const specBlockRange = findSpecJsonBlock(fullOutput);
  if (specBlockRange) {
    const before = fullOutput.substring(0, specBlockRange.start).trim();
    const after = fullOutput.substring(specBlockRange.end).trim();
    const combined = [before, after].filter(Boolean).join('\n\n');
    if (combined.length > 0) return combined;
  }

  if (parsedMessage) return parsedMessage;
  return fullOutput.trim();
}

/**
 * Locate the fenced JSON block that contains the spec-update schema
 * (has "specUpdates" or "isComplete" keys). Returns the start/end
 * offsets of the entire ``` ... ``` fence, or null if not found.
 */
function findSpecJsonBlock(text: string): { start: number; end: number } | null {
  // Match all fenced code blocks (```json ... ``` or ``` { ... ```)
  const fencePattern = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(text)) !== null) {
    const inner = match[1];
    if (inner.includes('specUpdates') || inner.includes('isComplete')) {
      return { start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}

/** Persist spec & meta updates from a parsed response */
function persistSpecUpdates(
  db: import('better-sqlite3').Database,
  io: import('socket.io').Server,
  task: { id: number; spec: string | null },
  parsed: ParsedResponse,
): void {
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
    const updated = queries.updateTask(db, task.id, taskUpdate);
    broadcast(io, 'task:updated', updated);
  }
}

/**
 * Spawn a corrective follow-up when the response was truncated (no JSON block)
 * or the agent broke its role boundary. Resumes the session with a correction prompt
 * and streams the result back to the client.
 */
function spawnCorrectionFollowup(
  db: import('better-sqlite3').Database,
  io: import('socket.io').Server,
  task: { id: number; projectId: string; title: string; description: string; spec: string | null },
  correctionPrompt: string,
  sessionId: string,
  projectPath: string | undefined,
  res: import('express').Response,
): void {
  // Resume the session — the correction prompt steers the bot back on track.
  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--resume', sessionId,
  ];

  console.log(`[http] /api/tasks/${task.id}/chat/stream correction follow-up on session ${sessionId}`);

  const corrState: StreamState = { fullText: '', streamedText: '', resumeFailed: false, resumeError: '' };

  const child = spawn('claude', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CLAUDECODE: undefined },
    cwd: projectPath ?? undefined,
  });

  child.stdin.write(correctionPrompt);
  child.stdin.end();

  const corrTimer = setTimeout(() => { child.kill(); }, 30_000);

  let corrLineBuffer = '';
  child.stdout.on('data', (chunk: Buffer) => {
    corrLineBuffer += chunk.toString();
    const lines = corrLineBuffer.split('\n');
    corrLineBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        handleStreamEvent(event, res, io, task.id, corrState);
      } catch { /* skip */ }
    }
  });

  child.on('close', () => {
    clearTimeout(corrTimer);
    if (corrLineBuffer.trim()) {
      try {
        const event = JSON.parse(corrLineBuffer) as Record<string, unknown>;
        handleStreamEvent(event, res, io, task.id, corrState);
      } catch { /* ignore */ }
    }

    const corrResponseText = corrState.fullText || corrState.streamedText;
    const corrParsed = parseResponseJson(corrResponseText);

    // The correction should be JSON-only — don't show it as a separate chat message.
    // Just apply the spec updates.
    if (Object.keys(corrParsed.specUpdates).length > 0 || corrParsed.isComplete) {
      console.log(`[http] /api/tasks/${task.id}/chat/stream correction recovered spec updates`);
      persistSpecUpdates(db, io, task, corrParsed);
    }

    if (!res.writableEnded) {
      sendSSE(res, {
        type: 'done',
        message: '', // Original message was already streamed
        specUpdates: corrParsed.specUpdates,
        titleUpdate: corrParsed.titleUpdate,
        descriptionUpdate: corrParsed.descriptionUpdate,
        riskLevelUpdate: corrParsed.riskLevelUpdate,
        isComplete: corrParsed.isComplete,
      });
      res.end();
    }
  });

  child.on('error', (err) => {
    clearTimeout(corrTimer);
    console.log(`[http] /api/tasks/${task.id}/chat/stream correction failed: ${err.message}`);
    if (!res.writableEnded) {
      sendSSE(res, {
        type: 'done',
        message: '',
        specUpdates: {},
        titleUpdate: null,
        descriptionUpdate: null,
        riskLevelUpdate: null,
        isComplete: false,
      });
      res.end();
    }
  });
}
