# Aetherium Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the Aetherium OS design system from the Stitch agentboard project — replacing the current token palette, building 8 new component primitives, restyling 5 existing components, and adding a `/design-system` style guide route.

**Architecture:** Three-layer CSS token system (primitive → semantic → component) in Tailwind v4 `@theme`. Existing components keep their semantic class names; only the underlying token values change. New components use glass/glow effects from the Aetherium palette. Living style guide at `/design-system` route.

**Tech Stack:** React 18, Tailwind CSS v4 (`@theme`), Vitest, Google Fonts (Space Grotesk, Manrope, JetBrains Mono)

**Spec:** `docs/superpowers/specs/2026-03-19-aetherium-design-system-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `ui/src/components/GlassCard.tsx` | Glassmorphism surface container (3 variants) |
| `ui/src/components/GlassCard.test.tsx` | GlassCard render + variant tests |
| `ui/src/components/StatusBadge.tsx` | Pipeline status indicator (15 statuses) |
| `ui/src/components/StatusBadge.test.tsx` | StatusBadge status-to-color mapping tests |
| `ui/src/components/MetricCard.tsx` | Dashboard stat display with trend |
| `ui/src/components/MetricCard.test.tsx` | MetricCard render + trend tests |
| `ui/src/components/TabbedPanel.tsx` | Tab switcher with bottom-border indicator |
| `ui/src/components/TabbedPanel.test.tsx` | TabbedPanel tab switching tests |
| `ui/src/components/ProgressStepper.tsx` | Horizontal pipeline stage dots |
| `ui/src/components/ProgressStepper.test.tsx` | ProgressStepper state mapping tests |
| `ui/src/components/TerminalPanel.tsx` | Monospace log output area |
| `ui/src/components/TerminalPanel.test.tsx` | TerminalPanel render + log level tests |
| `ui/src/components/ActionBar.tsx` | Grouped action button layout |
| `ui/src/components/ActionBar.test.tsx` | ActionBar alignment + split tests |
| `ui/src/components/StageColumn.tsx` | Kanban column with glass header |
| `ui/src/components/StageColumn.test.tsx` | StageColumn render tests |
| `ui/src/components/DesignSystem.tsx` | Living style guide page |
| `ui/src/components/DesignSystem.test.tsx` | Style guide smoke render test |

### Modified Files
| File | Changes |
|------|---------|
| `ui/index.html` | Google Fonts: Space Grotesk, Manrope (replace Inter) |
| `ui/src/app.css` | Full `@theme` token replacement + new effect classes |
| `ui/src/components/Button.tsx` | Export `ButtonVariant`, replace hard-coded `hover:bg-blue-600` |
| `ui/src/components/Sidebar.tsx` | Glass bg, "Design System" nav link |
| `ui/src/components/TopBar.tsx` | Glass surface, `font-heading` title, replace `hover:bg-blue-600` |
| `ui/src/components/TaskCard.tsx` | GlassCard wrapper, StatusBadge, ProgressStepper |
| `ui/src/components/Toast.tsx` | Glass background, Aetherium border colors |
| `ui/src/App.tsx` | `/design-system` route, replace `hover:bg-blue-600` |
| `ui/src/components/ErrorBoundary.tsx` | Replace `hover:bg-blue-600` |
| `ui/src/components/StageAccordion.tsx` | Replace `hover:bg-blue-600` |
| `ui/src/components/StageRow.tsx` | Replace `hover:bg-blue-600` |
| `ui/src/components/TaskForm.tsx` | Replace `hover:bg-blue-600` (2 instances) |
| `ui/src/components/Settings.tsx` | Replace `hover:bg-blue-600` |
| `ui/src/components/BlockedPanel.tsx` | Replace `bg-blue-*` risk badge classes |
| `ui/src/components/CostDashboard.tsx` | Replace `bg-blue-500`, `bg-purple-500` |
| `ui/src/components/EventsTimeline.tsx` | Replace `bg-purple-*`, `bg-blue-*` |

---

## Phase 1: Token Swap + Hard-Coded Color Audit

### Task 1: Google Fonts Update

**Files:**
- Modify: `ui/index.html:7-9`

- [ ] **Step 1: Replace the Google Fonts link**

In `ui/index.html`, replace the existing font `<link>` tag (line 9) with:

```html
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Manrope:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

Keep the existing preconnect lines (7-8) as-is. Also update the favicon SVG fill from `%233b82f6` (blue) to `%234eddb6` (Aetherium primary):

```html
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Crect width='20' height='20' rx='4' fill='%234eddb6'/%3E%3Cpath d='M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z' fill='white'/%3E%3C/svg%3E">
```

- [ ] **Step 2: Verify fonts load**

Run: `cd ui && npm run build`
Expected: Build succeeds. Open `dist/index.html` and confirm the font link tags are present.

- [ ] **Step 3: Commit**

```bash
git add ui/index.html
git commit -m "feat(ui): update Google Fonts to Aetherium typography (Space Grotesk, Manrope)"
```

---

### Task 2: Replace `@theme` Tokens in `app.css`

**Files:**
- Modify: `ui/src/app.css:1-25`

- [ ] **Step 1: Replace the `@theme` block**

Replace lines 3-25 of `ui/src/app.css` with the full Aetherium token set:

```css
@theme {
  /* ── Aetherium Primitive Tokens ── */

  /* Primary — mint/teal */
  --color-aeth-primary: #d3ffed;
  --color-aeth-primary-container: #64f0c8;
  --color-aeth-primary-fixed: #6ffad1;
  --color-aeth-primary-fixed-dim: #4eddb6;
  --color-aeth-on-primary: #00382b;
  --color-aeth-inverse-primary: #006b55;

  /* Secondary — cyan */
  --color-aeth-secondary: #6ad3ff;
  --color-aeth-secondary-container: #02b0e2;
  --color-aeth-secondary-fixed: #bee9ff;
  --color-aeth-secondary-fixed-dim: #6ad3ff;
  --color-aeth-on-secondary: #003546;

  /* Tertiary — coral */
  --color-aeth-tertiary: #fff3f2;
  --color-aeth-tertiary-container: #ffcdcb;
  --color-aeth-tertiary-fixed: #ffdad8;
  --color-aeth-tertiary-fixed-dim: #ffb3b1;
  --color-aeth-on-tertiary: #680011;

  /* Error */
  --color-aeth-error: #ffb4ab;
  --color-aeth-error-container: #93000a;
  --color-aeth-on-error: #690005;

  /* Warning (custom — distinct from error) */
  --color-aeth-warning: #f5a623;
  --color-aeth-warning-container: #5c3d00;

  /* Surfaces */
  --color-aeth-surface-lowest: #0b0e14;
  --color-aeth-surface: #101419;
  --color-aeth-surface-container-low: #181c22;
  --color-aeth-surface-container: #1c2026;
  --color-aeth-surface-container-high: #262a31;
  --color-aeth-surface-container-highest: #31353c;
  --color-aeth-surface-bright: #363940;
  --color-aeth-surface-tint: #4eddb6;
  --color-aeth-inverse-surface: #e0e2eb;

  /* Text */
  --color-aeth-on-surface: #e0e2eb;
  --color-aeth-on-surface-variant: #bbcac3;

  /* Outline */
  --color-aeth-outline: #85948d;
  --color-aeth-outline-variant: #3c4a44;

  /* ── Semantic Tokens (stable component API) ── */

  --color-bg-primary: #101419;
  --color-bg-secondary: #181c22;
  --color-bg-tertiary: #262a31;
  --color-bg-elevated: #31353c;

  --color-border-default: #3c4a44;
  --color-border-hover: #85948d;

  --color-text-primary: #e0e2eb;
  --color-text-secondary: #bbcac3;
  --color-text-tertiary: #85948d;

  --color-accent-blue: #4eddb6;
  --color-accent-blue-hover: #64f0c8;
  --color-accent-green: #64f0c8;
  --color-accent-amber: #f5a623;
  --color-accent-red: #ffb4ab;
  --color-accent-purple: #6ad3ff;
  --color-accent-pink: #ffcdcb;

  /* ── Radius ── */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-full: 9999px;

  /* ── Effect Tokens ── */
  --color-glass-bg: rgba(49, 53, 60, 0.4);
  --color-glass-border: rgba(100, 240, 200, 0.1);
  --color-glass-blur: 20px;

  /* ── Typography ── */
  --font-sans: 'Manrope', ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-heading: 'Space Grotesk', sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'Fira Code', monospace;
}
```

- [ ] **Step 2: Update `.card-running` class**

Replace the `.card-running` block (lines 144-148) with:

```css
.card-running {
  box-shadow: 0 0 0 1px var(--color-accent-purple),
              0 0 12px -4px rgba(106, 211, 255, 0.3);
}
```

- [ ] **Step 3: Update `gradient-border` animation**

Replace the `gradient-border` keyframe (lines 85-88) with:

```css
@keyframes gradient-border {
  0%, 100% { border-color: var(--color-accent-blue); }
  50% { border-color: var(--color-accent-purple); }
}
```

- [ ] **Step 4: Add glass utility classes**

Add after the `.card-running` block:

```css
/* Glass surface effect */
.glass-surface {
  background: var(--color-glass-bg);
  backdrop-filter: blur(var(--color-glass-blur));
  -webkit-backdrop-filter: blur(var(--color-glass-blur));
}

/* Glow effects */
.glow-primary {
  box-shadow: 0 0 15px rgba(100, 240, 200, 0.3);
}
.glow-error {
  box-shadow: 0 0 20px rgba(147, 0, 10, 0.4);
}
.glow-secondary {
  box-shadow: 0 0 20px rgba(106, 211, 255, 0.15);
}
```

- [ ] **Step 5: Build and verify**

Run: `cd ui && npm run build`
Expected: Build succeeds with no errors. The app renders with the new Aetherium dark palette.

- [ ] **Step 6: Commit**

```bash
git add ui/src/app.css
git commit -m "feat(ui): replace @theme tokens with Aetherium OS design system"
```

---

### Task 3: Hard-Coded Color Audit

**Files:**
- Modify: `ui/src/components/Button.tsx`, `ui/src/App.tsx`, `ui/src/components/ErrorBoundary.tsx`, `ui/src/components/StageAccordion.tsx`, `ui/src/components/StageRow.tsx`, `ui/src/components/TaskForm.tsx`, `ui/src/components/Settings.tsx`, `ui/src/components/TopBar.tsx`, `ui/src/components/BlockedPanel.tsx`, `ui/src/components/CostDashboard.tsx`, `ui/src/components/EventsTimeline.tsx`

- [ ] **Step 1: Fix Button.tsx — export ButtonVariant and replace hard-coded colors**

Change line 3 from:
```typescript
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost';
```
to:
```typescript
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost';
```

Replace `VARIANT_CLASSES` (lines 13-19):
```typescript
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent-blue text-white hover:bg-accent-blue-hover focus-visible:ring-accent-blue',
  secondary: 'border border-border-hover text-text-secondary hover:text-text-primary hover:bg-bg-tertiary focus-visible:ring-accent-blue',
  danger: 'border border-accent-red text-accent-red hover:bg-accent-red hover:text-white focus-visible:ring-accent-red',
  warning: 'border border-accent-amber text-accent-amber hover:bg-accent-amber hover:text-white focus-visible:ring-accent-amber',
  ghost: 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary focus-visible:ring-accent-blue',
};
```

- [ ] **Step 2: Replace `hover:bg-blue-600` in all other files**

In each of these files, find `hover:bg-blue-600` and replace with `hover:bg-accent-blue-hover`:
- `ui/src/App.tsx` (1 instance — the 404 "Back to Board" link)
- `ui/src/components/ErrorBoundary.tsx` (1 instance)
- `ui/src/components/StageAccordion.tsx` (1 instance)
- `ui/src/components/StageRow.tsx` (1 instance)
- `ui/src/components/TaskForm.tsx` (2 instances)
- `ui/src/components/Settings.tsx` (1 instance)
- `ui/src/components/TopBar.tsx` (1 instance)

- [ ] **Step 3: Fix BlockedPanel.tsx risk badge classes**

Replace `bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/20` with `bg-accent-blue/15 text-accent-blue ring-1 ring-accent-blue/20`. Replace the `dot: 'bg-blue-400'` with `dot: 'bg-accent-blue'`.

- [ ] **Step 4: Fix CostDashboard.tsx stage color map**

Replace `bg-blue-500` with `bg-accent-blue` and `bg-purple-500` with `bg-accent-purple`.

- [ ] **Step 5: Fix EventsTimeline.tsx status badge classes**

Replace `bg-purple-500/15 text-purple-400 ring-1 ring-purple-500/20` with `bg-accent-purple/15 text-accent-purple ring-1 ring-accent-purple/20`. Replace `bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/20` with `bg-accent-blue/15 text-accent-blue ring-1 ring-accent-blue/20`.

- [ ] **Step 6: Verify no hard-coded colors remain**

Run: `grep -rn 'bg-blue-\|text-blue-\|ring-blue-\|bg-purple-\|text-purple-\|ring-purple-' ui/src/`
Expected: No matches (or only false positives in comments).

- [ ] **Step 7: Build and test**

Run: `cd ui && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add ui/src/components/Button.tsx ui/src/App.tsx ui/src/components/ErrorBoundary.tsx ui/src/components/StageAccordion.tsx ui/src/components/StageRow.tsx ui/src/components/TaskForm.tsx ui/src/components/Settings.tsx ui/src/components/TopBar.tsx ui/src/components/BlockedPanel.tsx ui/src/components/CostDashboard.tsx ui/src/components/EventsTimeline.tsx
git commit -m "refactor(ui): replace hard-coded Tailwind colors with semantic Aetherium tokens"
```

---

## Phase 2: New Component Primitives

### Task 4: GlassCard

**Files:**
- Create: `ui/src/components/GlassCard.tsx`
- Create: `ui/src/components/GlassCard.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// ui/src/components/GlassCard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GlassCard } from './GlassCard';

describe('GlassCard', () => {
  it('renders children', () => {
    render(<GlassCard>Hello</GlassCard>);
    expect(screen.getByText('Hello')).toBeDefined();
  });

  it('applies default variant classes', () => {
    const { container } = render(<GlassCard>Content</GlassCard>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('glass-surface');
  });

  it('applies highlighted variant', () => {
    const { container } = render(<GlassCard variant="highlighted">Content</GlassCard>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('border-accent-blue');
  });

  it('applies error variant', () => {
    const { container } = render(<GlassCard variant="error">Content</GlassCard>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('border-accent-red');
  });

  it('applies glow when enabled', () => {
    const { container } = render(<GlassCard glow>Content</GlassCard>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('glow-primary');
  });

  it('applies padding sizes', () => {
    const { container } = render(<GlassCard padding="lg">Content</GlassCard>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('p-6');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ui && npx vitest run src/components/GlassCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement GlassCard**

```tsx
// ui/src/components/GlassCard.tsx
import React from 'react';

interface GlassCardProps {
  variant?: 'default' | 'highlighted' | 'error';
  padding?: 'sm' | 'md' | 'lg';
  glow?: boolean;
  className?: string;
  children: React.ReactNode;
}

const VARIANT_CLASSES = {
  default: 'border-glass-border',
  highlighted: 'border-accent-blue',
  error: 'border-accent-red',
} as const;

const GLOW_CLASSES = {
  default: 'glow-primary',
  highlighted: 'glow-primary',
  error: 'glow-error',
} as const;

const PADDING_CLASSES = {
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
} as const;

export const GlassCard: React.FC<GlassCardProps> = ({
  variant = 'default',
  padding = 'md',
  glow = false,
  className = '',
  children,
}) => (
  <div
    className={`glass-surface border rounded-lg ${VARIANT_CLASSES[variant]} ${PADDING_CLASSES[padding]} ${glow ? GLOW_CLASSES[variant] : ''} ${className}`}
  >
    {children}
  </div>
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ui && npx vitest run src/components/GlassCard.test.tsx`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/GlassCard.tsx ui/src/components/GlassCard.test.tsx
git commit -m "feat(ui): add GlassCard component with glassmorphism effect"
```

---

### Task 5: StatusBadge

**Files:**
- Create: `ui/src/components/StatusBadge.tsx`
- Create: `ui/src/components/StatusBadge.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// ui/src/components/StatusBadge.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders status label', () => {
    render(<StatusBadge status="implementing" />);
    expect(screen.getByText('implementing')).toBeDefined();
  });

  it('formats status labels with underscores', () => {
    render(<StatusBadge status="spec_review" />);
    expect(screen.getByText('spec review')).toBeDefined();
  });

  it('applies pulse class when pulse prop is true', () => {
    const { container } = render(<StatusBadge status="implementing" pulse />);
    const dot = container.querySelector('[class*="animate-pulse-dot"]');
    expect(dot).not.toBeNull();
  });

  it('applies sm size', () => {
    const { container } = render(<StatusBadge status="done" size="sm" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('text-[10px]');
  });

  it('maps done to primary-container color', () => {
    const { container } = render(<StatusBadge status="done" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('bg-accent-green/15');
  });

  it('maps failed to error color', () => {
    const { container } = render(<StatusBadge status="failed" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('bg-accent-red/15');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd ui && npx vitest run src/components/StatusBadge.test.tsx`

- [ ] **Step 3: Implement StatusBadge**

```tsx
// ui/src/components/StatusBadge.tsx
import React from 'react';
import type { TaskStatus } from '../types';

interface StatusBadgeProps {
  status: TaskStatus;
  size?: 'sm' | 'md';
  pulse?: boolean;
}

const STATUS_STYLES: Record<TaskStatus, string> = {
  backlog: 'bg-text-tertiary/15 text-text-tertiary ring-1 ring-text-tertiary/20',
  ready: 'bg-text-tertiary/15 text-text-tertiary ring-1 ring-text-tertiary/20',
  spec_review: 'bg-accent-purple/15 text-accent-purple ring-1 ring-accent-purple/20',
  planning: 'bg-accent-purple/15 text-accent-purple ring-1 ring-accent-purple/20',
  needs_plan_review: 'bg-accent-purple/15 text-accent-purple ring-1 ring-accent-purple/20',
  implementing: 'bg-accent-blue/15 text-accent-blue ring-1 ring-accent-blue/20',
  checks: 'bg-accent-green/15 text-accent-green ring-1 ring-accent-green/20',
  code_quality: 'bg-accent-green/15 text-accent-green ring-1 ring-accent-green/20',
  final_review: 'bg-accent-pink/15 text-accent-pink ring-1 ring-accent-pink/20',
  needs_human_review: 'bg-accent-purple/15 text-accent-purple ring-1 ring-accent-purple/20',
  pr_creation: 'bg-aeth-secondary-container/15 text-aeth-secondary-container ring-1 ring-aeth-secondary-container/20',
  done: 'bg-accent-green/15 text-accent-green ring-1 ring-accent-green/20',
  failed: 'bg-accent-red/15 text-accent-red ring-1 ring-accent-red/20',
  blocked: 'bg-accent-red/15 text-accent-red ring-1 ring-accent-red/20',
  cancelled: 'bg-text-tertiary/10 text-text-tertiary ring-1 ring-text-tertiary/10',
};

const PULSE_STATUSES: Set<TaskStatus> = new Set(['implementing']);

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  size = 'md',
  pulse,
}) => {
  const showPulse = pulse ?? PULSE_STATUSES.has(status);
  const sizeClass = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5';
  const label = status.replace(/_/g, ' ');

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${sizeClass} ${STATUS_STYLES[status]}`}>
      {showPulse && (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse-dot" />
      )}
      {label}
    </span>
  );
};
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd ui && npx vitest run src/components/StatusBadge.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/StatusBadge.tsx ui/src/components/StatusBadge.test.tsx
git commit -m "feat(ui): add StatusBadge component for pipeline state indicators"
```

---

### Task 6: MetricCard

**Files:**
- Create: `ui/src/components/MetricCard.tsx`
- Create: `ui/src/components/MetricCard.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// ui/src/components/MetricCard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricCard } from './MetricCard';

describe('MetricCard', () => {
  it('renders value and label', () => {
    render(<MetricCard label="Tasks" value={847} />);
    expect(screen.getByText('847')).toBeDefined();
    expect(screen.getByText('Tasks')).toBeDefined();
  });

  it('renders string values', () => {
    render(<MetricCard label="Rate" value="99.9%" />);
    expect(screen.getByText('99.9%')).toBeDefined();
  });

  it('shows up trend arrow', () => {
    const { container } = render(<MetricCard label="Tasks" value={10} trend="up" />);
    expect(container.querySelector('[data-trend="up"]')).not.toBeNull();
  });

  it('shows down trend arrow', () => {
    const { container } = render(<MetricCard label="Tasks" value={10} trend="down" />);
    expect(container.querySelector('[data-trend="down"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**
- [ ] **Step 3: Implement MetricCard**

```tsx
// ui/src/components/MetricCard.tsx
import React from 'react';
import { GlassCard } from './GlassCard';

interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'flat';
  icon?: React.ReactNode;
}

const TREND_COLORS = {
  up: 'text-accent-green',
  down: 'text-accent-red',
  flat: 'text-text-tertiary',
} as const;

export const MetricCard: React.FC<MetricCardProps> = ({ label, value, trend, icon }) => (
  <GlassCard padding="lg">
    <div className="flex items-start justify-between">
      <div>
        <div className="text-2xl font-bold font-heading text-text-primary">{value}</div>
        <div className="text-sm text-text-secondary mt-1">{label}</div>
      </div>
      {icon && <div className="text-text-tertiary">{icon}</div>}
    </div>
    {trend && (
      <div className={`mt-2 text-xs font-medium ${TREND_COLORS[trend]}`} data-trend={trend}>
        {trend === 'up' ? '\u2191' : trend === 'down' ? '\u2193' : '\u2192'}
        {' '}{trend}
      </div>
    )}
  </GlassCard>
);
```

- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add ui/src/components/MetricCard.tsx ui/src/components/MetricCard.test.tsx
git commit -m "feat(ui): add MetricCard component for dashboard stats"
```

---

### Task 7: TabbedPanel

**Files:**
- Create: `ui/src/components/TabbedPanel.tsx`
- Create: `ui/src/components/TabbedPanel.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// ui/src/components/TabbedPanel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabbedPanel } from './TabbedPanel';

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'logs', label: 'Logs', count: 5 },
  { id: 'spec', label: 'Spec' },
];

describe('TabbedPanel', () => {
  it('renders all tab labels', () => {
    render(<TabbedPanel tabs={tabs} activeTab="overview" onTabChange={() => {}}><div>Content</div></TabbedPanel>);
    expect(screen.getByText('Overview')).toBeDefined();
    expect(screen.getByText('Logs')).toBeDefined();
    expect(screen.getByText('Spec')).toBeDefined();
  });

  it('shows count badge', () => {
    render(<TabbedPanel tabs={tabs} activeTab="overview" onTabChange={() => {}}><div>Content</div></TabbedPanel>);
    expect(screen.getByText('5')).toBeDefined();
  });

  it('calls onTabChange when tab clicked', () => {
    const onChange = vi.fn();
    render(<TabbedPanel tabs={tabs} activeTab="overview" onTabChange={onChange}><div>Content</div></TabbedPanel>);
    fireEvent.click(screen.getByText('Logs'));
    expect(onChange).toHaveBeenCalledWith('logs');
  });

  it('renders children', () => {
    render(<TabbedPanel tabs={tabs} activeTab="overview" onTabChange={() => {}}><div>Tab content</div></TabbedPanel>);
    expect(screen.getByText('Tab content')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**
- [ ] **Step 3: Implement TabbedPanel**

```tsx
// ui/src/components/TabbedPanel.tsx
import React from 'react';

interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

interface TabbedPanelProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  children: React.ReactNode;
}

export const TabbedPanel: React.FC<TabbedPanelProps> = ({ tabs, activeTab, onTabChange, children }) => (
  <div>
    <div className="flex border-b border-border-default" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeTab}
          onClick={() => onTabChange(tab.id)}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-heading font-medium transition-colors cursor-pointer ${
            tab.id === activeTab
              ? 'text-accent-blue border-b-2 border-accent-blue -mb-px'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {tab.icon}
          {tab.label}
          {tab.count != null && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-purple/15 text-accent-purple font-medium">
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
    <div role="tabpanel" className="mt-4">{children}</div>
  </div>
);
```

- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add ui/src/components/TabbedPanel.tsx ui/src/components/TabbedPanel.test.tsx
git commit -m "feat(ui): add TabbedPanel component with bottom-border indicator"
```

---

### Task 8: ProgressStepper

**Files:**
- Create: `ui/src/components/ProgressStepper.tsx`
- Create: `ui/src/components/ProgressStepper.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// ui/src/components/ProgressStepper.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProgressStepper } from './ProgressStepper';
import type { Stage, StageLogStatus } from '../types';

const stages: Stage[] = ['spec_review', 'planning', 'implementing', 'checks', 'code_quality', 'final_review', 'pr_creation'];

describe('ProgressStepper', () => {
  it('renders correct number of stage dots', () => {
    const { container } = render(<ProgressStepper stages={stages} stageStatuses={{}} />);
    const dots = container.querySelectorAll('[data-stage]');
    expect(dots.length).toBe(7);
  });

  it('marks completed stages', () => {
    const statuses: Partial<Record<Stage, StageLogStatus>> = {
      spec_review: 'completed',
      planning: 'completed',
    };
    const { container } = render(<ProgressStepper stages={stages} stageStatuses={statuses} />);
    const completed = container.querySelectorAll('[data-status="completed"]');
    expect(completed.length).toBe(2);
  });

  it('marks active stage with pulse', () => {
    const { container } = render(<ProgressStepper stages={stages} currentStage="implementing" stageStatuses={{ spec_review: 'completed', planning: 'completed' }} />);
    const active = container.querySelector('[data-status="running"]');
    expect(active).not.toBeNull();
  });

  it('renders in compact mode', () => {
    const { container } = render(<ProgressStepper stages={stages} stageStatuses={{}} compact />);
    const dots = container.querySelectorAll('[data-stage]');
    // compact dots are smaller — check they exist
    expect(dots.length).toBe(7);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**
- [ ] **Step 3: Implement ProgressStepper**

```tsx
// ui/src/components/ProgressStepper.tsx
import React from 'react';
import type { Stage, StageLogStatus } from '../types';

interface ProgressStepperProps {
  stages: Stage[];
  currentStage?: Stage;
  stageStatuses: Partial<Record<Stage, StageLogStatus>>;
  blockedAtStage?: string;
  compact?: boolean;
}

const dotSize = (compact: boolean) => compact ? 'w-1.5 h-1.5' : 'w-2 h-2';
const lineHeight = (compact: boolean) => compact ? 'h-0.5' : 'h-0.5';

function getStageVisual(
  stage: Stage,
  status: StageLogStatus | undefined,
  isCurrent: boolean,
  isBlocked: boolean,
): { dot: string; status: string } {
  if (isBlocked) return { dot: 'bg-accent-red glow-error', status: 'blocked' };
  if (status === 'completed') return { dot: 'bg-accent-green', status: 'completed' };
  if (status === 'failed') return { dot: 'bg-accent-red', status: 'failed' };
  if (isCurrent || status === 'running') return { dot: 'bg-accent-blue animate-pulse-dot glow-primary', status: 'running' };
  return { dot: 'bg-border-default', status: 'pending' };
}

export const ProgressStepper: React.FC<ProgressStepperProps> = ({
  stages,
  currentStage,
  stageStatuses,
  blockedAtStage,
  compact = false,
}) => (
  <div className="flex items-center gap-0.5">
    {stages.map((stage, i) => {
      const visual = getStageVisual(
        stage,
        stageStatuses[stage],
        stage === currentStage,
        stage === blockedAtStage,
      );
      return (
        <React.Fragment key={stage}>
          {i > 0 && (
            <div className={`flex-1 min-w-1 ${lineHeight(compact)} ${
              stageStatuses[stages[i - 1]] === 'completed' ? 'bg-accent-green' : 'bg-border-default'
            }`} />
          )}
          <div
            data-stage={stage}
            data-status={visual.status}
            className={`rounded-full ${dotSize(compact)} ${visual.dot}`}
            title={`${stage.replace(/_/g, ' ')} — ${visual.status}`}
          />
        </React.Fragment>
      );
    })}
  </div>
);
```

- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add ui/src/components/ProgressStepper.tsx ui/src/components/ProgressStepper.test.tsx
git commit -m "feat(ui): add ProgressStepper component for pipeline stage visualization"
```

---

### Task 9: TerminalPanel

**Files:**
- Create: `ui/src/components/TerminalPanel.tsx`
- Create: `ui/src/components/TerminalPanel.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// ui/src/components/TerminalPanel.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TerminalPanel } from './TerminalPanel';
import type { LogLine } from './TerminalPanel';

describe('TerminalPanel', () => {
  it('renders string content', () => {
    render(<TerminalPanel content="Hello world" />);
    expect(screen.getByText('Hello world')).toBeDefined();
  });

  it('renders LogLine array', () => {
    const lines: LogLine[] = [
      { level: 'info', message: 'Starting...' },
      { level: 'error', message: 'Failed!' },
    ];
    render(<TerminalPanel content={lines} />);
    expect(screen.getByText('Starting...')).toBeDefined();
    expect(screen.getByText('Failed!')).toBeDefined();
  });

  it('renders title when provided', () => {
    render(<TerminalPanel content="test" title="Build Output" />);
    expect(screen.getByText('Build Output')).toBeDefined();
  });

  it('applies terminal background', () => {
    const { container } = render(<TerminalPanel content="test" />);
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain('bg-aeth-surface-lowest');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**
- [ ] **Step 3: Implement TerminalPanel**

```tsx
// ui/src/components/TerminalPanel.tsx
import React, { useRef, useEffect } from 'react';

export interface LogLine {
  level: 'info' | 'warn' | 'error' | 'debug';
  timestamp?: string;
  message: string;
}

interface TerminalPanelProps {
  content: string | LogLine[];
  maxHeight?: string;
  autoScroll?: boolean;
  title?: string;
}

const LEVEL_COLORS: Record<LogLine['level'], string> = {
  info: 'text-text-primary',
  warn: 'text-accent-amber',
  error: 'text-accent-red',
  debug: 'text-text-tertiary',
};

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  content,
  maxHeight = '400px',
  autoScroll = true,
  title,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, autoScroll]);

  return (
    <div className="bg-aeth-surface-lowest rounded-lg overflow-hidden border border-border-default">
      {title && (
        <div className="px-3 py-2 border-b border-border-default text-xs font-heading font-medium text-text-secondary uppercase tracking-wide">
          {title}
        </div>
      )}
      <div
        ref={scrollRef}
        className="p-3 font-mono text-[13px] leading-relaxed overflow-auto"
        style={{ maxHeight, scrollbarWidth: 'thin', scrollbarColor: '#262a31 transparent' }}
      >
        {typeof content === 'string' ? (
          <pre className="whitespace-pre-wrap text-text-primary">{content}</pre>
        ) : (
          content.map((line, i) => (
            <div key={i} className={`${LEVEL_COLORS[line.level]}`}>
              {line.timestamp && <span className="text-text-tertiary mr-2">{line.timestamp}</span>}
              <span className="text-text-tertiary mr-1">[{line.level.toUpperCase().padEnd(5)}]</span>
              {line.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add ui/src/components/TerminalPanel.tsx ui/src/components/TerminalPanel.test.tsx
git commit -m "feat(ui): add TerminalPanel component for monospace log output"
```

---

### Task 10: ActionBar

**Files:**
- Create: `ui/src/components/ActionBar.tsx`
- Create: `ui/src/components/ActionBar.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// ui/src/components/ActionBar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionBar } from './ActionBar';

describe('ActionBar', () => {
  const actions = [
    { label: 'Approve', variant: 'primary' as const, onClick: vi.fn() },
    { label: 'Abort', variant: 'danger' as const, onClick: vi.fn() },
  ];

  it('renders all action buttons', () => {
    render(<ActionBar actions={actions} />);
    expect(screen.getByText('Approve')).toBeDefined();
    expect(screen.getByText('Abort')).toBeDefined();
  });

  it('calls onClick when button clicked', () => {
    render(<ActionBar actions={actions} />);
    fireEvent.click(screen.getByText('Approve'));
    expect(actions[0].onClick).toHaveBeenCalled();
  });

  it('applies split alignment', () => {
    const { container } = render(<ActionBar actions={actions} align="split" />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('justify-between');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**
- [ ] **Step 3: Implement ActionBar**

```tsx
// ui/src/components/ActionBar.tsx
import React from 'react';
import { Button } from './Button';
import type { ButtonVariant } from './Button';

interface Action {
  label: string;
  variant: ButtonVariant;
  onClick: () => void;
  icon?: React.ReactNode;
  loading?: boolean;
}

interface ActionBarProps {
  actions: Action[];
  align?: 'left' | 'right' | 'split';
}

const ALIGN_CLASSES = {
  left: 'justify-start',
  right: 'justify-end',
  split: 'justify-between',
} as const;

const DESTRUCTIVE: Set<ButtonVariant> = new Set(['danger', 'warning']);

export const ActionBar: React.FC<ActionBarProps> = ({ actions, align = 'right' }) => {
  if (align === 'split') {
    const destructive = actions.filter((a) => DESTRUCTIVE.has(a.variant));
    const safe = actions.filter((a) => !DESTRUCTIVE.has(a.variant));
    return (
      <div className={`flex items-center gap-3 ${ALIGN_CLASSES.split}`}>
        <div className="flex items-center gap-3">
          {destructive.map((a) => (
            <Button key={a.label} variant={a.variant} onClick={a.onClick} loading={a.loading}>{a.icon}{a.label}</Button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {safe.map((a) => (
            <Button key={a.label} variant={a.variant} onClick={a.onClick} loading={a.loading}>{a.icon}{a.label}</Button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 ${ALIGN_CLASSES[align]}`}>
      {actions.map((a) => (
        <Button key={a.label} variant={a.variant} onClick={a.onClick} loading={a.loading}>{a.icon}{a.label}</Button>
      ))}
    </div>
  );
};
```

- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add ui/src/components/ActionBar.tsx ui/src/components/ActionBar.test.tsx
git commit -m "feat(ui): add ActionBar component for grouped action buttons"
```

---

### Task 11: StageColumn

**Files:**
- Create: `ui/src/components/StageColumn.tsx`
- Create: `ui/src/components/StageColumn.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// ui/src/components/StageColumn.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StageColumn } from './StageColumn';

describe('StageColumn', () => {
  it('renders title and count', () => {
    render(<StageColumn title="Implementing" count={3} status="implementing"><div>Cards</div></StageColumn>);
    expect(screen.getByText('Implementing')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();
  });

  it('renders children', () => {
    render(<StageColumn title="Test" count={0} status="checks"><div>Child content</div></StageColumn>);
    expect(screen.getByText('Child content')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**
- [ ] **Step 3: Implement StageColumn**

```tsx
// ui/src/components/StageColumn.tsx
import React from 'react';
import type { Stage } from '../types';

interface StageColumnProps {
  title: string;
  count: number;
  status: Stage;
  children: React.ReactNode;
}

export const StageColumn: React.FC<StageColumnProps> = ({ title, count, children }) => (
  <div className="flex flex-col min-w-[320px] flex-1">
    <div className="glass-surface flex items-center justify-between px-4 py-3 border-b border-border-default rounded-t-lg">
      <span className="text-sm font-heading font-medium text-text-secondary uppercase tracking-wide">{title}</span>
      <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent-purple/15 text-accent-purple font-medium">{count}</span>
    </div>
    <div className="flex-1 overflow-auto p-2 flex flex-col gap-2">
      {children}
    </div>
  </div>
);
```

- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add ui/src/components/StageColumn.tsx ui/src/components/StageColumn.test.tsx
git commit -m "feat(ui): add StageColumn component for kanban board columns"
```

---

## Phase 3: Restyle Existing Components

### Task 12: Restyle Sidebar, TopBar, Button, Toast

**Files:**
- Modify: `ui/src/components/Sidebar.tsx`
- Modify: `ui/src/components/TopBar.tsx`
- Modify: `ui/src/components/Toast.tsx`

Read each file before editing. The changes are targeted class replacements:

- [ ] **Step 1: Sidebar — add glass background and font-heading**

In `Sidebar.tsx`, find the main sidebar container `<aside>` or `<nav>` element. Add `glass-surface` to its className. Find nav item labels and add `font-heading` where appropriate for section headers. Add a new "Design System" nav link below "Costs":

```tsx
{ path: '/design-system', label: 'Design System', icon: (
  <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18H9.071l6-6H16a2 2 0 012 2v2a2 2 0 01-2 2z" clipRule="evenodd" />
  </svg>
) }
```

- [ ] **Step 2: TopBar — add glass surface and heading font**

In `TopBar.tsx`, add `glass-surface` to the top bar container's className. Add `font-heading` to the title element.

- [ ] **Step 3: Toast — add glass background**

In `Toast.tsx`, replace the Root className `bg-bg-elevated` with `glass-surface`:

```tsx
className={`glass-surface border ${VARIANT_CLASSES[t.variant]} rounded-lg px-4 py-3 shadow-lg`}
```

- [ ] **Step 4: Build and verify**

Run: `cd ui && npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/Sidebar.tsx ui/src/components/TopBar.tsx ui/src/components/Toast.tsx
git commit -m "feat(ui): apply Aetherium glass effects to Sidebar, TopBar, and Toast"
```

---

### Task 13: Restyle TaskCard

**Files:**
- Modify: `ui/src/components/TaskCard.tsx`

- [ ] **Step 1: Read TaskCard.tsx**

Read the file to understand current structure before editing.

- [ ] **Step 2: Add GlassCard wrapper, StatusBadge, ProgressStepper imports**

Add imports at the top:
```tsx
import { GlassCard } from './GlassCard';
import { StatusBadge } from './StatusBadge';
import { ProgressStepper } from './ProgressStepper';
```

- [ ] **Step 3: Wrap card content in GlassCard**

Replace the outer card `<div>` with `<GlassCard variant={task.claimedBy ? 'highlighted' : 'default'}>`. Remove the old left-border status indicator. Add `<StatusBadge status={task.status} size="sm" />` in the card header. Add a compact `<ProgressStepper>` at the bottom of the card.

- [ ] **Step 4: Build and verify**

Run: `cd ui && npm run build`

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/TaskCard.tsx
git commit -m "feat(ui): restyle TaskCard with GlassCard, StatusBadge, and ProgressStepper"
```

---

## Phase 4: Style Guide Route

### Task 14: DesignSystem Page + Route

**Files:**
- Create: `ui/src/components/DesignSystem.tsx`
- Create: `ui/src/components/DesignSystem.test.tsx`
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Write smoke test**

```tsx
// ui/src/components/DesignSystem.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DesignSystem } from './DesignSystem';

describe('DesignSystem', () => {
  it('renders the page title', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Aetherium Design System')).toBeDefined();
  });

  it('renders color palette section', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Color Palette')).toBeDefined();
  });

  it('renders typography section', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Typography')).toBeDefined();
  });

  it('renders components section', () => {
    render(<DesignSystem />);
    expect(screen.getByText('Components')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**
- [ ] **Step 3: Implement DesignSystem.tsx**

Build the style guide page with all 7 sections as specified in the spec: Header, Color Palette, Typography, Spacing & Radius, Effects, Components, Icons. Use a sticky left section nav with anchor links. Render every component in all its variants. Reference the Stitch project in the header.

This is a large presentational component. Keep it as a single file since it has no reusable logic — it's a showcase page. Use data arrays to drive the swatch grids and component demos to keep the JSX DRY.

- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Add route to App.tsx**

In `ui/src/App.tsx`, add at the top:
```tsx
const DesignSystem = React.lazy(() => import('./components/DesignSystem').then(m => ({ default: m.DesignSystem })));
```

Add the route inside `<Routes>`:
```tsx
<Route path="/design-system" element={<React.Suspense fallback={<div className="p-6 text-text-secondary">Loading...</div>}><DesignSystem /></React.Suspense>} />
```

Update the `titles` map and `getTitle` function to include `'/design-system': 'Design System — Agentboard'`.

- [ ] **Step 6: Build and verify**

Run: `cd ui && npm run build`
Expected: Build succeeds. Navigate to `/design-system` and see the full style guide.

- [ ] **Step 7: Commit**

```bash
git add ui/src/components/DesignSystem.tsx ui/src/components/DesignSystem.test.tsx ui/src/App.tsx
git commit -m "feat(ui): add /design-system living style guide route"
```

---

## Phase 5: Final Verification

### Task 15: Full Test Suite + Build

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Run UI build**

Run: `npm run build`
Expected: Clean build with no errors.

- [ ] **Step 3: Run grep audit for leftover hard-coded colors**

Run: `grep -rn 'bg-blue-\|text-blue-\|ring-blue-\|bg-purple-\|text-purple-\|ring-purple-' ui/src/ --include='*.tsx'`
Expected: No matches.

- [ ] **Step 4: Update visual test baselines (if visual tests exist)**

Run: `npm run test:visual:update`
Expected: Baselines updated to reflect Aetherium palette.

- [ ] **Step 5: Final commit**

```bash
git add ui/dist/ browser-tests/ audit-screenshots/
git commit -m "chore(ui): update visual test baselines for Aetherium design system"
```
