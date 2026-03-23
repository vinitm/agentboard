# Stage Log Beautification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Claude's markdown output in stage logs as formatted rich text instead of raw plain text.

**Architecture:** The `LogRenderer` already parses structural markers (STAGE, EVENT, start/end, errors) into styled components. The remaining `content` and `timestamp` line types contain Claude's raw markdown output which is currently rendered as `whitespace-pre-wrap` monospace. We'll group consecutive content/timestamp lines into markdown blocks and render them through the existing `Markdown` component (which already uses `react-markdown` with dark-theme-styled components). A compact variant of the Markdown component will be created to fit the dense log context, with `font-sans` to override the parent container's `font-mono`.

**Tech Stack:** React, `react-markdown` (already installed), existing `Markdown` component, Tailwind CSS

---

### Task 1: Create compact Markdown variant for log context

The existing `Markdown` component uses 13px text and generous spacing suited for spec/plan display. Logs need a denser version with smaller text (12px/11px) and tighter margins to match the existing monospace log density. The parent `StageRow` container sets `font-mono`, so compact mode also adds `font-sans` to reset to proportional text for rendered prose.

**Files:**
- Modify: `ui/src/components/Markdown.tsx`

- [ ] **Step 1: Add compactComponents and compact prop to Markdown.tsx**

In `ui/src/components/Markdown.tsx`, add after the existing `components` const (around line 78):

```tsx
const compactComponents: Components = {
  ...components,
  // Tighter headings for log context
  h1({ children }) { return <h1 className="text-[13px] font-bold text-text-primary mt-2 mb-1">{children}</h1>; },
  h2({ children }) { return <h2 className="text-[12px] font-bold text-text-primary mt-2 mb-0.5">{children}</h2>; },
  h3({ children }) { return <h3 className="text-[12px] font-semibold text-text-primary mt-1.5 mb-0.5">{children}</h3>; },
  h4({ children }) { return <h4 className="text-[11px] font-semibold text-text-primary mt-1 mb-0.5">{children}</h4>; },
  // Denser paragraphs
  p({ children }) { return <p className="text-[12px] text-text-secondary leading-relaxed mb-1 last:mb-0">{children}</p>; },
  // Tighter lists
  ul({ children }) { return <ul className="list-disc list-outside ml-3 mb-1 space-y-0">{children}</ul>; },
  ol({ children }) { return <ol className="list-decimal list-outside ml-3 mb-1 space-y-0">{children}</ol>; },
  li({ children }) { return <li className="text-[12px] text-text-secondary leading-relaxed">{children}</li>; },
  // Smaller code blocks + inline code
  pre({ children }) {
    return (
      <pre className="bg-bg-primary border border-border-default rounded p-2 my-1 overflow-x-auto text-[11px] leading-relaxed font-mono">
        {children}
      </pre>
    );
  },
  code({ className, children, ...props }) {
    const isBlock = className?.startsWith('language-');
    if (isBlock) {
      return (
        <code className={`font-mono text-[11px] text-text-primary ${className || ''}`} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="font-mono text-[11px] bg-bg-tertiary text-accent-blue px-1 py-0.5 rounded border border-border-default" {...props}>
        {children}
      </code>
    );
  },
  // Smaller blockquotes
  blockquote({ children }) {
    return (
      <blockquote className="border-l-2 border-accent-blue/40 pl-2 my-1 text-text-tertiary italic text-[12px]">
        {children}
      </blockquote>
    );
  },
};
```

Then update the Props interface and component:

```tsx
interface Props {
  children: string;
  className?: string;
  compact?: boolean;
}

export const Markdown: React.FC<Props> = ({ children, className = '', compact = false }) => (
  <div className={`markdown-content ${compact ? 'font-sans' : ''} ${className}`}>
    <ReactMarkdown components={compact ? compactComponents : components}>{children}</ReactMarkdown>
  </div>
);
```

Note: `font-sans` on the wrapper resets the inherited `font-mono` from `StageRow`'s log container. Code blocks explicitly set `font-mono` back via `pre` and `code` overrides.

- [ ] **Step 2: Run typecheck**

Run: `cd ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/Markdown.tsx
git commit -m "feat: add compact mode to Markdown component for log rendering"
```

---

### Task 2: Add groupIntoBlocks and update LogRenderer for markdown rendering

The core change: instead of rendering `content` and `timestamp` lines as raw `whitespace-pre-wrap` divs, group consecutive content/timestamp lines into markdown blocks and render them through the compact Markdown component. Both line types are grouped together in a single pass (not split across tasks) to avoid intermediate type inconsistencies.

**Files:**
- Modify: `ui/src/lib/parse-log-lines.ts`
- Modify: `ui/src/components/LogRenderer.tsx`

- [ ] **Step 1: Add LogBlock type and groupIntoBlocks function to parse-log-lines.ts**

At the bottom of `ui/src/lib/parse-log-lines.ts`, add:

```ts
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
```

- [ ] **Step 2: Replace LogRenderer.tsx with block-based rendering**

Replace `ui/src/components/LogRenderer.tsx` with:

```tsx
import React, { useMemo } from 'react';
import { parseLogText, groupIntoBlocks, type ParsedLogLine } from '../lib/parse-log-lines.js';
import { Markdown } from './Markdown.js';

interface Props {
  text: string;
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

function MetaBadge({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] bg-bg-tertiary text-text-tertiary rounded px-1.5 py-0.5 font-mono">
      <span className="text-text-quaternary">{label}</span>{value}
    </span>
  );
}

const LogLine: React.FC<{ line: ParsedLogLine }> = ({ line }) => {
  switch (line.type) {
    case 'separator':
      return <div className="border-b border-border-default my-2" />;

    case 'header':
      return (
        <div className="font-semibold text-text-primary text-xs py-1">
          {line.content}
        </div>
      );

    case 'stage':
      return (
        <div className="flex items-center gap-2 py-1.5 mt-2 border-b border-accent-purple/20">
          <span className="text-accent-purple font-semibold text-xs">STAGE</span>
          <span className="text-text-primary text-xs font-medium">{line.content.split('(')[0].trim()}</span>
          <div className="flex gap-1.5 ml-auto">
            {line.metadata.run && <MetaBadge label="run " value={line.metadata.run} />}
            {line.metadata.attempt && <MetaBadge label="attempt " value={line.metadata.attempt} />}
          </div>
        </div>
      );

    case 'subtask':
      return (
        <div className="flex items-center gap-2 py-1.5 mt-2 border-b border-accent-blue/20">
          <span className="text-accent-blue font-semibold text-xs">SUBTASK</span>
          <span className="text-text-primary text-xs font-medium">{line.content}</span>
        </div>
      );

    case 'event':
      return (
        <div className="flex items-center gap-2 py-1 mt-1">
          <span className="text-accent-amber font-semibold text-[10px] uppercase tracking-wider">EVENT</span>
          <span className="text-text-secondary text-xs">{line.content.replace(/_/g, ' ')}</span>
        </div>
      );

    case 'start':
      return (
        <div className="flex items-center gap-2 py-0.5 text-text-tertiary">
          {line.timestamp && (
            <span className="text-[10px] font-mono text-text-quaternary w-16 flex-shrink-0">{formatTimestamp(line.timestamp)}</span>
          )}
          <span className="text-[10px] font-medium text-accent-green/70 uppercase">start</span>
          <div className="flex gap-1.5">
            {Object.entries(line.metadata).map(([k, v]) => (
              <MetaBadge key={k} label={`${k} `} value={v} />
            ))}
          </div>
        </div>
      );

    case 'end':
      return (
        <div className="flex items-center gap-2 py-0.5 text-text-tertiary">
          {line.timestamp && (
            <span className="text-[10px] font-mono text-text-quaternary w-16 flex-shrink-0">{formatTimestamp(line.timestamp)}</span>
          )}
          <span className={`text-[10px] font-medium uppercase ${
            line.metadata.status === 'completed' ? 'text-accent-green/70' :
            line.metadata.status === 'failed' ? 'text-accent-red/70' :
            'text-text-tertiary'
          }`}>end</span>
          <div className="flex gap-1.5">
            {Object.entries(line.metadata).map(([k, v]) => (
              <MetaBadge key={k} label={`${k} `} value={v} />
            ))}
          </div>
        </div>
      );

    case 'error':
      return (
        <div className="flex items-start gap-2 py-0.5 bg-red-500/10 rounded px-1.5 -mx-1.5">
          {line.timestamp && (
            <span className="text-[10px] font-mono text-red-400/60 w-16 flex-shrink-0">{formatTimestamp(line.timestamp)}</span>
          )}
          <span className="text-[10px] font-bold text-red-400 flex-shrink-0">ERROR</span>
          <span className="text-xs text-red-300">{line.content}</span>
        </div>
      );

    case 'timestamp':
    case 'content':
      // Should not reach here when using block-based rendering,
      // but kept as fallback for safety
      if (!line.content.trim()) return <div className="h-1" />;
      return (
        <div className="text-xs text-text-primary whitespace-pre-wrap break-words">
          {line.content}
        </div>
      );

    default:
      return <div className="text-xs text-text-primary whitespace-pre-wrap">{line.content}</div>;
  }
};

export const LogRenderer: React.FC<Props> = ({ text }) => {
  const blocks = useMemo(() => {
    const lines = parseLogText(text);
    return groupIntoBlocks(lines);
  }, [text]);

  if (blocks.length === 0) return null;

  return (
    <div className="space-y-0">
      {blocks.map((block, i) =>
        block.kind === 'markdown' ? (
          <div key={i} className="flex items-start gap-2 py-0.5">
            {block.timestamp && (
              <span className="text-[10px] font-mono text-text-quaternary w-16 flex-shrink-0 pt-0.5">
                {formatTimestamp(block.timestamp)}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <Markdown compact>{block.text}</Markdown>
            </div>
          </div>
        ) : (
          <LogLine key={i} line={block.line} />
        )
      )}
    </div>
  );
};
```

- [ ] **Step 3: Run typecheck**

Run: `cd ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/LogRenderer.tsx ui/src/lib/parse-log-lines.ts
git commit -m "feat: render stage log content as formatted markdown

Groups consecutive content and timestamp lines into markdown blocks,
rendered via the compact Markdown component instead of raw whitespace-pre-wrap."
```

---

### Task 3: Add unit tests for groupIntoBlocks

The test file `ui/src/lib/parse-log-lines.test.ts` already exists with tests for `parseLogLine` and `parseLogText`. Append a new `describe('groupIntoBlocks')` block — do not duplicate existing tests.

**Files:**
- Modify: `ui/src/lib/parse-log-lines.test.ts`

- [ ] **Step 1: Add groupIntoBlocks import and test suite**

Update the import line at top of `ui/src/lib/parse-log-lines.test.ts`:

```ts
import { parseLogLine, parseLogText, groupIntoBlocks } from './parse-log-lines.js';
```

Then append after the existing `describe('parseLogText')` block:

```ts
describe('groupIntoBlocks', () => {
  it('groups consecutive content lines into a markdown block', () => {
    const lines = parseLogText('## Heading\n- item 1\n- item 2');
    const blocks = groupIntoBlocks(lines);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('markdown');
    if (blocks[0].kind === 'markdown') {
      expect(blocks[0].text).toContain('## Heading');
      expect(blocks[0].text).toContain('- item 1');
    }
  });

  it('groups consecutive timestamp lines into a markdown block with first timestamp', () => {
    const lines = parseLogText(
      '[2026-03-18T10:30:00.000Z] ## Analysis\n[2026-03-18T10:30:01.000Z] The code looks good\n[2026-03-18T10:30:02.000Z] - No issues found'
    );
    const blocks = groupIntoBlocks(lines);
    expect(blocks).toHaveLength(1);
    if (blocks[0].kind === 'markdown') {
      expect(blocks[0].timestamp).toBe('2026-03-18T10:30:00.000Z');
      expect(blocks[0].text).toContain('## Analysis');
    }
  });

  it('preserves structural lines as individual blocks', () => {
    const text = [
      '── STAGE: planning (run: abc, attempt: 1) ──────',
      '[2026-03-18T10:30:00.000Z] [start] model=opus',
      '## My Plan',
      '- Step 1',
      '[2026-03-18T10:31:00.000Z] [end] status=completed',
    ].join('\n');
    const lines = parseLogText(text);
    const blocks = groupIntoBlocks(lines);

    expect(blocks[0]).toEqual(expect.objectContaining({ kind: 'line' }));
    if (blocks[0].kind === 'line') expect(blocks[0].line.type).toBe('stage');

    expect(blocks[1]).toEqual(expect.objectContaining({ kind: 'line' }));
    if (blocks[1].kind === 'line') expect(blocks[1].line.type).toBe('start');

    expect(blocks[2]).toEqual(expect.objectContaining({ kind: 'markdown' }));

    expect(blocks[3]).toEqual(expect.objectContaining({ kind: 'line' }));
    if (blocks[3].kind === 'line') expect(blocks[3].line.type).toBe('end');
  });

  it('skips empty content blocks', () => {
    const lines = parseLogText('\n\n');
    const blocks = groupIntoBlocks(lines);
    expect(blocks).toHaveLength(0);
  });

  it('handles mixed content and timestamp lines in one block', () => {
    const lines = parseLogText(
      '[2026-03-18T10:30:00.000Z] First line\nplain continuation\n[2026-03-18T10:30:01.000Z] Third line'
    );
    const blocks = groupIntoBlocks(lines);
    expect(blocks).toHaveLength(1);
    if (blocks[0].kind === 'markdown') {
      expect(blocks[0].text).toContain('First line');
      expect(blocks[0].text).toContain('plain continuation');
      expect(blocks[0].text).toContain('Third line');
    }
  });

  it('preserves indented code in timestamp content for markdown code blocks', () => {
    const lines = parseLogText(
      '[2026-03-18T10:30:00.000Z] Here is some code:\n[2026-03-18T10:30:01.000Z]     const x = 1;\n[2026-03-18T10:30:02.000Z]     const y = 2;'
    );
    const blocks = groupIntoBlocks(lines);
    expect(blocks).toHaveLength(1);
    if (blocks[0].kind === 'markdown') {
      expect(blocks[0].text).toContain('    const x = 1;');
      expect(blocks[0].text).toContain('    const y = 2;');
    }
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd ui && npx vitest run src/lib/parse-log-lines.test.ts`
Expected: All tests pass (existing + new)

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/parse-log-lines.test.ts
git commit -m "test: add unit tests for groupIntoBlocks log line grouping"
```

---

### Task 4: Build and verify end-to-end

**Files:** None (verification only)

- [ ] **Step 1: Build the UI**

Run: `cd ui && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Build the server**

Run: `npm run build`
Expected: Full build succeeds

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Final commit if any fixes needed**

If any build/test fixes were needed, commit them:
```bash
git commit -m "fix: address build/test issues from log beautification"
```
