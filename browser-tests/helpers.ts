import { execFile, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export interface LightpandaContext {
  process: ChildProcess | null;
  endpoint: string;
  port: number;
  docker: boolean;
}

const DEFAULT_PORT = 9222;

/** Path where @lightpanda/browser npm package downloads the binary */
const LIGHTPANDA_CACHE_BIN = path.join(os.homedir(), '.cache', 'lightpanda-node', 'lightpanda');

/**
 * Wait for Lightpanda's CDP endpoint to become available.
 * Polls GET http://127.0.0.1:{port}/json/version until it responds.
 */
export function waitForCDP(
  port: number,
  timeout = 15_000,
): Promise<void> {
  const versionUrl = `http://127.0.0.1:${port}/json/version`;

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;

    function poll() {
      if (Date.now() > deadline) {
        reject(new Error(`CDP endpoint not ready after ${timeout}ms: ${versionUrl}`));
        return;
      }

      const req = http.get(versionUrl, (res) => {
        if (res.statusCode === 200) {
          res.resume();
          resolve();
        } else {
          res.resume();
          setTimeout(poll, 200);
        }
      });

      req.on('error', () => {
        setTimeout(poll, 200);
      });

      req.setTimeout(2000, () => {
        req.destroy();
        setTimeout(poll, 200);
      });
    }

    poll();
  });
}

/**
 * Start Lightpanda headless browser.
 *
 * Two modes:
 * - npm binary (default): uses the binary downloaded by @lightpanda/browser to ~/.cache/lightpanda-node/
 * - Docker (LIGHTPANDA_DOCKER=1): runs `docker run lightpanda/browser:nightly`
 *
 * The binary uses `lightpanda serve --host 127.0.0.1 --port <port>` to start a CDP websocket server.
 */
export async function startLightpanda(
  port: number = DEFAULT_PORT,
): Promise<LightpandaContext> {
  const useDocker = process.env.LIGHTPANDA_DOCKER === '1';
  const endpoint = `ws://127.0.0.1:${port}`;

  if (useDocker) {
    const child = execFile('docker', [
      'run', '--rm',
      '-p', `${port}:${port}`,
      'lightpanda/browser:nightly',
      'serve',
      '--host', '0.0.0.0',
      '--port', String(port),
    ]);

    child.stderr?.on('data', (data: Buffer) => {
      if (process.env.LIGHTPANDA_DEBUG) {
        console.log(`[lightpanda:docker] ${data.toString().trim()}`);
      }
    });

    await waitForCDP(port);
    return { process: child, endpoint, port, docker: true };
  }

  // npm binary mode — use the cached binary from @lightpanda/browser
  const binPath = process.env.LIGHTPANDA_EXECUTABLE_PATH || LIGHTPANDA_CACHE_BIN;

  const child = execFile(binPath, [
    'serve',
    '--host', '127.0.0.1',
    '--port', String(port),
  ]);

  child.stderr?.on('data', (data: Buffer) => {
    if (process.env.LIGHTPANDA_DEBUG) {
      console.log(`[lightpanda] ${data.toString().trim()}`);
    }
  });

  await waitForCDP(port);
  return { process: child, endpoint, port, docker: false };
}

/**
 * Stop a running Lightpanda instance.
 */
export async function stopLightpanda(ctx: LightpandaContext): Promise<void> {
  if (!ctx.process) return;

  ctx.process.kill('SIGTERM');

  // Wait for process to exit (up to 5s)
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      ctx.process?.kill('SIGKILL');
      resolve();
    }, 5000);

    ctx.process?.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
