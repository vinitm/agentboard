#!/usr/bin/env node
/**
 * Ruflo MCP Proxy
 *
 * Fixes ruflo's MCP server which advertises resources/prompts capabilities
 * but doesn't implement the required handlers, causing Claude Code to
 * mark the connection as failed.
 *
 * Strategy: intercept the initialize response to strip capabilities that
 * ruflo can't actually handle (resources, prompts), and also intercept
 * any calls to those methods just in case, returning valid empty responses.
 */
import { spawn } from 'node:child_process';

// Methods ruflo advertises but doesn't handle — intercept just in case
const PATCHED_METHODS = {
  'resources/list': (id) => ({
    jsonrpc: '2.0', id, result: { resources: [] }
  }),
  'resources/templates/list': (id) => ({
    jsonrpc: '2.0', id, result: { resourceTemplates: [] }
  }),
  'prompts/list': (id) => ({
    jsonrpc: '2.0', id, result: { prompts: [] }
  }),
};

// Track which request IDs are initialize requests so we can patch the response
const initializeRequestIds = new Set();

// Spawn the real ruflo MCP server
const child = spawn('npx', ['-y', 'ruflo@3.5.30', 'mcp', 'start'], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, npm_config_update_notifier: 'false' },
});

child.on('exit', (code) => process.exit(code ?? 1));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));

// Process child stdout — patch initialize responses to strip broken capabilities
let childBuffer = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  childBuffer += chunk;
  const lines = childBuffer.split('\n');
  childBuffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) {
      process.stdout.write('\n');
      continue;
    }
    try {
      const msg = JSON.parse(line);
      // Patch initialize response: remove resources and prompts capabilities
      if (msg.id != null && initializeRequestIds.has(msg.id) && msg.result?.capabilities) {
        delete msg.result.capabilities.resources;
        delete msg.result.capabilities.prompts;
        initializeRequestIds.delete(msg.id);
        process.stdout.write(JSON.stringify(msg) + '\n');
      } else {
        process.stdout.write(line + '\n');
      }
    } catch {
      process.stdout.write(line + '\n');
    }
  }
});

// Intercept our stdin (Claude Code requests), patch or forward
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);

      // Track initialize request IDs so we can patch the response
      if (msg.method === 'initialize' && msg.id != null) {
        initializeRequestIds.add(msg.id);
      }

      const patcher = PATCHED_METHODS[msg.method];
      if (patcher && msg.id != null) {
        process.stdout.write(JSON.stringify(patcher(msg.id)) + '\n');
      } else {
        child.stdin.write(line + '\n');
      }
    } catch {
      child.stdin.write(line + '\n');
    }
  }
});

process.stdin.on('end', () => {
  child.stdin.end();
});
