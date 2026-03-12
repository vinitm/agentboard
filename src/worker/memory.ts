import fs from 'node:fs';
import path from 'node:path';

export interface WorkerMemory {
  failurePatterns: Array<{
    pattern: string;
    resolution: string;
    count: number;
  }>;
  conventions: Array<{
    key: string;
    value: string;
  }>;
  lastUpdated: string;
}

const MEMORY_FILE = 'memory.json';

function memoryPath(configDir: string): string {
  return path.join(configDir, MEMORY_FILE);
}

function emptyMemory(): WorkerMemory {
  return {
    failurePatterns: [],
    conventions: [],
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Load persisted worker memory from the .agentboard directory.
 * Returns an empty memory if the file doesn't exist or is corrupt.
 */
export function loadMemory(configDir: string): WorkerMemory {
  const filePath = memoryPath(configDir);
  try {
    if (!fs.existsSync(filePath)) {
      return emptyMemory();
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as WorkerMemory;
    // Basic validation
    if (!Array.isArray(parsed.failurePatterns) || !Array.isArray(parsed.conventions)) {
      return emptyMemory();
    }
    return parsed;
  } catch {
    return emptyMemory();
  }
}

/**
 * Persist worker memory to the .agentboard directory.
 */
export function saveMemory(configDir: string, memory: WorkerMemory): void {
  const filePath = memoryPath(configDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  memory.lastUpdated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(memory, null, 2), 'utf-8');
}

/**
 * Record a failure pattern. If the same pattern already exists, increment its
 * count and update the resolution. Otherwise add a new entry.
 */
export function recordFailure(
  memory: WorkerMemory,
  pattern: string,
  resolution: string
): void {
  const existing = memory.failurePatterns.find((fp) => fp.pattern === pattern);
  if (existing) {
    existing.count++;
    existing.resolution = resolution;
  } else {
    memory.failurePatterns.push({ pattern, resolution, count: 1 });
  }
}

/**
 * Record a convention. If the key already exists, update its value.
 * Otherwise add a new entry.
 */
export function recordConvention(
  memory: WorkerMemory,
  key: string,
  value: string
): void {
  const existing = memory.conventions.find((c) => c.key === key);
  if (existing) {
    existing.value = value;
  } else {
    memory.conventions.push({ key, value });
  }
}
