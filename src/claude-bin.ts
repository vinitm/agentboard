import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const COMMON_PATHS = [
  `${process.env.HOME}/.local/bin/claude`,
  `${process.env.HOME}/.nvm/versions/node/${process.version}/bin/claude`,
  '/usr/local/bin/claude',
  '/usr/bin/claude',
];

let resolved: string | undefined;

/**
 * Resolve the `claude` CLI binary path.
 * Checks PATH via `which`, then falls back to common install locations.
 * Caches the result after the first successful lookup.
 */
export function claudeBin(): string {
  if (resolved) return resolved;

  // Try PATH first
  try {
    const result = execFileSync('which', ['claude'], { encoding: 'utf8', timeout: 3000 }).trim();
    if (result) {
      resolved = result;
      return resolved;
    }
  } catch {
    // not on PATH — try common locations
  }

  for (const p of COMMON_PATHS) {
    if (existsSync(p)) {
      resolved = p;
      return resolved;
    }
  }

  // Fall back to bare 'claude' — will produce a clear ENOENT if missing
  resolved = 'claude';
  return resolved;
}
