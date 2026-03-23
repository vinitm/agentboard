/**
 * Parses raw log text into structured lines for rich rendering.
 *
 * Log lines come in formats like:
 *  - "[2026-03-18T10:30:00.000Z] some content"
 *  - "[2026-03-18T10:30:00.000Z] [start] model=claude-opus-4-6"
 *  - "[2026-03-18T10:30:00.000Z] [end] status=completed tokens=1234 duration=5000ms"
 *  - "[2026-03-18T10:30:00.000Z] [ERROR] something went wrong"
 *  - "── STAGE: planning (run: abc, attempt: 1) ──────"
 *  - "── SUBTASK 1/3: Title (42) ──────"
 *  - "── EVENT: subtasks_created ──────"
 *  - "════════════════════════════════════════"  (separator)
 *  - "TASK: Some title"
 *  - Plain text (Claude's streaming output)
 */

export type LogLineType =
  | 'timestamp'    // Regular timestamped line
  | 'start'        // Stage start marker
  | 'end'          // Stage end marker
  | 'error'        // Error line
  | 'stage'        // Stage header
  | 'subtask'      // Subtask header
  | 'event'        // Event marker
  | 'separator'    // Visual separator
  | 'header'       // Task header (TASK: ...)
  | 'content';     // Plain content (Claude output)

export interface ParsedLogLine {
  type: LogLineType;
  timestamp: string | null;
  content: string;
  metadata: Record<string, string>;
}

const TIMESTAMP_RE = /^\s*\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\]\s*/;
const STAGE_HEADER_RE = /^[─\s]*STAGE:\s*(.+?)\s*[─]*$/;
const SUBTASK_HEADER_RE = /^[─\s]*SUBTASK\s+(\d+\/\d+):\s*(.+?)\s*[─]*$/;
const EVENT_HEADER_RE = /^[─\s]*EVENT:\s*(.+?)\s*[─]*$/;
const SEPARATOR_RE = /^[═]{10,}$/;
const TASK_HEADER_RE = /^TASK:\s*(.+)$/;
const META_KV_RE = /(\w+)=(\S+)/g;
const STAGE_META_RE = /(\w+):\s*([^,)]+)/g;

export function parseLogLine(raw: string): ParsedLogLine {
  const trimmed = raw.trimEnd();

  // Separator
  if (SEPARATOR_RE.test(trimmed.trim())) {
    return { type: 'separator', timestamp: null, content: '', metadata: {} };
  }

  // Stage header
  const stageMatch = STAGE_HEADER_RE.exec(trimmed.trim());
  if (stageMatch) {
    const meta: Record<string, string> = {};
    for (const m of stageMatch[1].matchAll(STAGE_META_RE)) {
      meta[m[1].trim()] = m[2].trim();
    }
    return { type: 'stage', timestamp: null, content: stageMatch[1], metadata: meta };
  }

  // Subtask header
  const subtaskMatch = SUBTASK_HEADER_RE.exec(trimmed.trim());
  if (subtaskMatch) {
    return { type: 'subtask', timestamp: null, content: `${subtaskMatch[1]}: ${subtaskMatch[2]}`, metadata: { index: subtaskMatch[1] } };
  }

  // Event header
  const eventMatch = EVENT_HEADER_RE.exec(trimmed.trim());
  if (eventMatch) {
    return { type: 'event', timestamp: null, content: eventMatch[1], metadata: {} };
  }

  // Task header
  const taskMatch = TASK_HEADER_RE.exec(trimmed.trim());
  if (taskMatch) {
    return { type: 'header', timestamp: null, content: taskMatch[1], metadata: {} };
  }

  // Timestamped lines
  const tsMatch = TIMESTAMP_RE.exec(trimmed);
  if (tsMatch) {
    const ts = tsMatch[1];
    const rest = trimmed.slice(tsMatch[0].length);

    // [start] marker
    if (rest.startsWith('[start]')) {
      const meta: Record<string, string> = {};
      for (const m of rest.matchAll(META_KV_RE)) {
        meta[m[1]] = m[2];
      }
      return { type: 'start', timestamp: ts, content: rest.replace('[start]', '').trim(), metadata: meta };
    }

    // [end] marker
    if (rest.startsWith('[end]')) {
      const meta: Record<string, string> = {};
      for (const m of rest.matchAll(META_KV_RE)) {
        meta[m[1]] = m[2];
      }
      return { type: 'end', timestamp: ts, content: rest.replace('[end]', '').trim(), metadata: meta };
    }

    // [ERROR] marker
    if (rest.startsWith('[ERROR]')) {
      return { type: 'error', timestamp: ts, content: rest.replace('[ERROR]', '').trim(), metadata: {} };
    }

    // Regular timestamped content
    return { type: 'timestamp', timestamp: ts, content: rest, metadata: {} };
  }

  // Plain content
  return { type: 'content', timestamp: null, content: trimmed, metadata: {} };
}

/**
 * Pre-process raw log text before line parsing.
 *
 * Stage log files may contain raw Claude CLI JSON output (from --output-format json)
 * instead of the structured timestamp-based format. This happens because the onOutput
 * callback in stage-runner captures raw stdout chunks which, in JSON mode, is the full
 * JSON result object.
 *
 * This function detects JSON blobs and extracts the `.result` field (the actual
 * Claude text output) so downstream parsing and markdown rendering work correctly.
 * Multiple concatenated JSON objects are also handled (one per line).
 */
function extractFromJson(text: string): string {
  const trimmed = text.trim();

  // Quick check: does it look like JSON?
  if (!trimmed.startsWith('{')) return text;

  const results: string[] = [];

  // Handle multiple concatenated JSON objects (one per line, as seen in planning logs)
  for (const chunk of trimmed.split('\n')) {
    const line = chunk.trim();
    if (!line.startsWith('{')) {
      results.push(chunk);
      continue;
    }
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (typeof parsed.result === 'string') {
        results.push(parsed.result);
      } else {
        // Valid JSON but no result field — keep as-is
        results.push(chunk);
      }
    } catch {
      // Not valid JSON — keep as-is
      results.push(chunk);
    }
  }

  return results.join('\n');
}

export function parseLogText(text: string): readonly ParsedLogLine[] {
  if (!text) return [];
  const processed = extractFromJson(text);
  return processed.split('\n').map(parseLogLine);
}

export type LogBlock =
  | { kind: 'line'; line: ParsedLogLine }
  | { kind: 'markdown'; text: string; timestamp?: string };

/**
 * Groups consecutive 'content' and 'timestamp' lines into markdown blocks.
 * All other line types (stage, event, start, end, error, separator, header, subtask)
 * stay as individual structured lines.
 *
 * This is necessary because markdown elements (code blocks, lists)
 * span multiple raw lines and must be parsed together.
 */
export function groupIntoBlocks(lines: readonly ParsedLogLine[]): readonly LogBlock[] {
  const blocks: LogBlock[] = [];
  let contentAccum: string[] = [];
  let firstTimestamp: string | undefined;

  function flushContent(): void {
    if (contentAccum.length === 0) return;
    const text = contentAccum.join('\n');
    if (text.trim()) {
      blocks.push({ kind: 'markdown', text, timestamp: firstTimestamp });
    }
    contentAccum = [];
    firstTimestamp = undefined;
  }

  for (const line of lines) {
    if (line.type === 'content' || line.type === 'timestamp') {
      if (line.type === 'timestamp' && !firstTimestamp) {
        firstTimestamp = line.timestamp ?? undefined;
      }
      contentAccum.push(line.content);
    } else {
      flushContent();
      blocks.push({ kind: 'line', line });
    }
  }
  flushContent();

  return blocks;
}
