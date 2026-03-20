# Aetherium Design System — Full Integration Spec

**Date:** 2026-03-19
**Status:** Approved
**Stitch Source:** `projects/12574215853376337205` (agentboard)
**Stitch Screens:** Board View, Task Detail, Spec Editor, Agent Terminal, System Metrics

## Overview

Integrate the Aetherium OS design system from the Stitch agentboard project into the agentboard UI. This includes replacing the current token palette, building 8 new component primitives, restyling existing components, and adding a living `/design-system` style guide route.

## Goals

1. Replace the current basic dark theme with the Aetherium OS visual identity
2. Maintain a stable semantic token API so existing components don't break
3. Build reusable primitives for patterns seen in the Stitch screens (glass cards, status badges, metric cards, etc.)
4. Provide a living style guide at `/design-system` that showcases all tokens and components
5. Zero new npm dependencies (fonts via Google Fonts CDN)

## Non-Goals

- Automated Stitch sync (manual re-extraction is acceptable)
- Light theme / theme switching (Aetherium is dark-only)
- Changing component logic, API contracts, or state management
- Mobile-specific responsive overhaul

---

## Token Architecture

Three-layer system in `app.css` using Tailwind v4 `@theme`:

### Layer 1: Primitive Tokens (raw Aetherium values)

```css
/* Primary — mint/teal */
--aeth-primary: #d3ffed;
--aeth-primary-container: #64f0c8;
--aeth-primary-fixed: #6ffad1;
--aeth-primary-fixed-dim: #4eddb6;
--aeth-on-primary: #00382b;
--aeth-inverse-primary: #006b55;

/* Secondary — cyan */
--aeth-secondary: #6ad3ff;
--aeth-secondary-container: #02b0e2;
--aeth-secondary-fixed: #bee9ff;
--aeth-secondary-fixed-dim: #6ad3ff;
--aeth-on-secondary: #003546;

/* Tertiary — coral */
--aeth-tertiary: #fff3f2;
--aeth-tertiary-container: #ffcdcb;
--aeth-tertiary-fixed: #ffdad8;
--aeth-tertiary-fixed-dim: #ffb3b1;
--aeth-on-tertiary: #680011;

/* Error */
--aeth-error: #ffb4ab;
--aeth-error-container: #93000a;
--aeth-on-error: #690005;

/* Warning (custom — not in MD3 palette, needed for distinct warning/error) */
--aeth-warning: #f5a623;
--aeth-warning-container: #5c3d00;

/* Surfaces (7-step hierarchy, dark to light) */
--aeth-surface-lowest: #0b0e14;
--aeth-surface: #101419;
--aeth-surface-container-low: #181c22;
--aeth-surface-container: #1c2026;
--aeth-surface-container-high: #262a31;
--aeth-surface-container-highest: #31353c;
--aeth-surface-bright: #363940;
--aeth-surface-tint: #4eddb6;
--aeth-inverse-surface: #e0e2eb;

/* Text / On-surface */
--aeth-on-surface: #e0e2eb;
--aeth-on-surface-variant: #bbcac3;

/* Outline */
--aeth-outline: #85948d;
--aeth-outline-variant: #3c4a44;

/* Typography */
--aeth-font-heading: 'Space Grotesk', sans-serif;
--aeth-font-body: 'Manrope', sans-serif;
--aeth-font-mono: 'JetBrains Mono', monospace;

/* Radius */
--aeth-radius-sm: 0.25rem;
--aeth-radius-md: 0.5rem;
--aeth-radius-lg: 0.75rem;
--aeth-radius-full: 9999px;

/* Effects */
--aeth-glass-bg: rgba(49, 53, 60, 0.4);
--aeth-glass-border: rgba(100, 240, 200, 0.1);
--aeth-glass-blur: 20px;
--aeth-glow-primary: 0 0 15px rgba(100, 240, 200, 0.3);
--aeth-glow-error: 0 0 20px rgba(147, 0, 10, 0.4);
--aeth-glow-secondary: 0 0 20px rgba(106, 211, 255, 0.15);
```

### Layer 2: Semantic Tokens (stable API for components)

Maps existing Tailwind token names to Aetherium primitives:

| Semantic Token | Aetherium Primitive | Purpose |
|---|---|---|
| `--color-bg-primary` | `--aeth-surface` (#101419) | Page background |
| `--color-bg-secondary` | `--aeth-surface-container-low` (#181c22) | Cards, panels |
| `--color-bg-tertiary` | `--aeth-surface-container-high` (#262a31) | Hover, disabled |
| `--color-bg-elevated` | `--aeth-surface-container-highest` (#31353c) | Modals, floating |
| `--color-border-default` | `--aeth-outline-variant` (#3c4a44) | Normal borders |
| `--color-border-hover` | `--aeth-outline` (#85948d) | Hover borders |
| `--color-text-primary` | `--aeth-on-surface` (#e0e2eb) | Main text |
| `--color-text-secondary` | `--aeth-on-surface-variant` (#bbcac3) | Secondary text |
| `--color-text-tertiary` | `--aeth-outline` (#85948d) | Hints, metadata |
| `--color-accent-blue` | `--aeth-primary-fixed-dim` (#4eddb6) | Primary actions |
| `--color-accent-green` | `--aeth-primary-container` (#64f0c8) | Success |
| `--color-accent-amber` | `--aeth-warning` (#f5a623) | Warnings |
| `--color-accent-red` | `--aeth-error` (#ffb4ab) | Errors |
| `--color-accent-purple` | `--aeth-secondary` (#6ad3ff) | Running/active |
| `--color-accent-pink` | `--aeth-tertiary-container` (#ffcdcb) | Needs review |
| `--font-sans` | `--aeth-font-body` (Manrope) | Body text |
| `--font-mono` | `--aeth-font-mono` (JetBrains Mono) | Code/logs |
| `--font-heading` (new) | `--aeth-font-heading` (Space Grotesk) | Headings/labels |

### Layer 3: Component Tokens (optional scoped overrides)

Used only when a component needs to deviate from semantic defaults:

```css
--glass-bg: var(--aeth-glass-bg);
--glass-border: var(--aeth-glass-border);
--glass-blur: var(--aeth-glass-blur);
--terminal-bg: var(--aeth-surface-lowest);
```

---

## New Component Primitives

### GlassCard

Signature Aetherium surface container with glassmorphism effect.

```typescript
interface GlassCardProps {
  variant?: 'default' | 'highlighted' | 'error';
  padding?: 'sm' | 'md' | 'lg';
  glow?: boolean;
  className?: string;
  children: React.ReactNode;
}
```

**Styles:**
- `default`: `background: var(--glass-bg)`, `backdrop-filter: blur(var(--glass-blur))`, `border: 1px solid var(--glass-border)`
- `highlighted`: border shifts to `var(--aeth-primary-fixed-dim)`, optional glow shadow
- `error`: border shifts to `var(--aeth-error)`, error glow shadow
- Padding: sm=`p-3`, md=`p-4`, lg=`p-6`

### StatusBadge

Pipeline state indicator with semantic coloring.

```typescript
interface StatusBadgeProps {
  status: TaskStatus;
  size?: 'sm' | 'md';
  pulse?: boolean;
}
```

**Status-to-color mapping:**
- `backlog` / `ready` → outline (muted)
- `spec_review` / `planning` / `needs_plan_review` / `needs_human_review` → secondary (cyan)
- `implementing` → primary (mint) + pulse
- `checks` / `code_quality` → primary-fixed (bright mint)
- `final_review` → tertiary (coral)
- `pr_creation` → secondary-container
- `done` → primary-container (green)
- `failed` → error (coral-red)
- `blocked` → error-container
- `cancelled` → outline-variant (dimmed)

### MetricCard

Dashboard stat display.

```typescript
interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'flat';
  icon?: React.ReactNode;
}
```

**Layout:** GlassCard wrapping: large value (Space Grotesk, text-2xl, font-bold), label (text-sm, text-secondary), optional trend arrow (up=green, down=error, flat=muted), optional icon top-right.

### TabbedPanel

Content tab switcher.

```typescript
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
```

**Style:** Tab bar with bottom-border indicator using primary color. Space Grotesk for tab labels. Count badge in secondary color. Active tab has 2px bottom border in primary-fixed-dim.

### ProgressStepper

Horizontal pipeline stage visualization.

```typescript
interface ProgressStepperProps {
  stages: Stage[];
  currentStage?: Stage;
  stageStatuses: Partial<Record<Stage, StageLogStatus>>;
  compact?: boolean;
}
```

**Visual:** Circles (8px default, 6px compact) connected by 2px lines. Completed = primary-container fill. Active = primary-fixed-dim fill + glow + pulse. Failed = error fill. Pending = outline-variant stroke only.

**Non-stage statuses:** When a task's current status is not a pipeline stage (`backlog`, `ready`, `blocked`, `cancelled`, `done`, `failed`):
- `done` → all stages show as completed
- `failed` → stages up to the failed point show completed, the failing stage shows error, rest pending
- `blocked` → stages up to `blockedAtStage` show completed, blocked stage shows error glow, rest pending. `blockedAtStage` is sourced from `Task.blockedAtStage` field (already in the Task interface in `types/index.ts`), passed as an optional prop.
- `backlog` / `ready` / `cancelled` → all stages show as pending

### TerminalPanel

Monospace log output area.

```typescript
interface LogLine {
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
```

**Style:** Background `var(--aeth-surface-lowest)` (#0b0e14). JetBrains Mono 13px. Custom scrollbar (4px, surface-container-high thumb). Log levels: info=on-surface, warn=warning (#f5a623), error=error, debug=outline.

### ActionBar

Grouped action button layout.

```typescript
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
```

**Layout:** Flex row with gap-3. `split` puts danger/warning variants on the left, primary/secondary on the right via `justify-between`. Uses existing Button component. Requires exporting `ButtonVariant` type from `Button.tsx`.

### StageColumn

Kanban column for the board view.

```typescript
interface StageColumnProps {
  title: string;
  count: number;
  status: Stage;
  children: React.ReactNode;
}
```

**Style:** `min-width: 320px` (not fixed, allows flex grow). Glass header with title (Space Grotesk, text-sm, uppercase, tracking-wide) and count badge. Vertical scroll area for cards with gap-2. Intended to be used inside the TaskGrid board layout, replacing the current inline column rendering. Integrates with the existing `.board-scroll-container` horizontal scroll wrapper.

---

## Existing Component Restyling

These changes happen via the token swap (Phase 1) plus targeted updates (Phase 3):

### Sidebar
- Glass background effect on the sidebar container
- Nav item hover: surface-container-high background
- Active nav item: primary-fixed-dim left border + tinted background
- Space Grotesk for section labels

### TaskCard
- Wrap content in GlassCard
- Replace left-border status indicator with StatusBadge
- Add compact ProgressStepper
- Running state: use `--aeth-glow-primary` instead of current purple glow

### TopBar
- Glass surface background
- Space Grotesk for title
- Search input: surface-container background, outline-variant border

### Button
- Primary variant: primary-fixed-dim background, on-primary text
- Hover: primary-container background
- Focus ring: primary-fixed-dim color

### Toast
- Glass background
- Border colors from Aetherium semantic palette

---

## Living Style Guide

### Route: `/design-system`

Lazy-loaded via `React.lazy` + `Suspense` in `App.tsx`.

### File: `ui/src/components/DesignSystem.tsx`

Single component rendering all sections.

### Sidebar Integration

New nav item "Design System" below "Costs" in `Sidebar.tsx` with palette icon.

### Sections

1. **Header** — "Aetherium Design System" title, "Living style guide — synced with Stitch" subtitle, Stitch project link badge.

2. **Color Palette** — Swatches grid organized by category (primary, secondary, tertiary, error, surfaces, text, outline). Each swatch: color preview rectangle, token name, hex value, semantic alias.

3. **Typography** — Specimens:
   - Space Grotesk: h1 (2xl bold), h2 (xl bold), h3 (lg semibold), h4 (base semibold), label (sm medium uppercase tracking-wide)
   - Manrope: body-lg (base), body (sm), body-sm (xs), caption (xs muted)
   - JetBrains Mono: code-block, inline-code, terminal-output

4. **Spacing & Radius** — Visual scale: 0.25rem, 0.5rem, 0.75rem, 9999px shown on sample rounded boxes.

5. **Effects** — Live demos: glass blur (3 levels), neon glow (primary/error/secondary), skeleton shimmer, gradient border animation.

6. **Components** — Every component in all variants:
   - Button: 5 variants x 2 sizes, loading, disabled
   - GlassCard: default/highlighted/error, glow on/off
   - StatusBadge: all TaskStatus values, sm/md
   - MetricCard: sample metrics with trends
   - TabbedPanel: 3-tab interactive example
   - ProgressStepper: early/mid/complete/failed states
   - TerminalPanel: sample colored log output
   - ActionBar: approve/abort, left/right/split
   - StageColumn: with sample TaskCards
   - Toast: trigger buttons per variant
   - Tooltip: hover targets, top/bottom
   - ConfirmDialog: danger/warning triggers
   - EmptyState: with and without action

7. **Icons** — Material Symbols reference grid with names.

### In-Page Navigation

Sticky left section nav (200px) within the content area. Active section highlighted with primary left border. Scrolls to anchor IDs.

---

## Migration Strategy

### Phase 1: Token Swap + Hard-Coded Color Audit

1. Add Google Fonts imports for Space Grotesk and Manrope to `ui/index.html`:
   ```html
   <link rel="preconnect" href="https://fonts.googleapis.com">
   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
   <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Manrope:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
   ```
2. Replace `@theme` block in `app.css` with Aetherium primitives + semantic mappings
3. Add new tokens: `--font-heading` (registered in `@theme` so Tailwind generates `font-heading` utility), glass/glow effect variables
4. Update `.card-running` class to use `--aeth-glow-primary`
5. Update `gradient-border` animation to use primary → secondary (mint-to-cyan pulse)
6. **Audit and replace hard-coded Tailwind color utilities.** The following files contain raw Tailwind color classes (e.g., `hover:bg-blue-600`, `bg-purple-500`) that bypass semantic tokens and will clash after the swap:
   - `Button.tsx` — `hover:bg-blue-600` → `hover:bg-accent-green` (or define `--color-accent-blue-hover`)
   - `App.tsx` — `hover:bg-blue-600` in 404 page link
   - `ErrorBoundary.tsx` — `hover:bg-blue-600` in reload button
   - `StageAccordion.tsx` — `hover:bg-blue-600` in action button
   - `StageRow.tsx` — `hover:bg-blue-600` in expand button
   - `TaskForm.tsx` — `hover:bg-blue-600` in submit buttons (2 instances)
   - `Settings.tsx` — `hover:bg-blue-600` in save button
   - `TopBar.tsx` — `hover:bg-blue-600` in "New Task" button
   - `BlockedPanel.tsx` — `bg-blue-500/15`, `text-blue-400`, `ring-blue-500/20` in risk badges
   - `CostDashboard.tsx` — `bg-blue-500`, `bg-purple-500` in stage color map
   - `EventsTimeline.tsx` — `bg-purple-500/15`, `text-purple-400`, `bg-blue-500/15`, `text-blue-400` in status badges

   **Strategy:** Replace all hard-coded `blue-*` classes with semantic `accent-blue` equivalents. Add a new `--color-accent-blue-hover` token for hover states. Replace hard-coded `purple-*` with `accent-purple`. This keeps Phase 1 as a token-only change — components use semantic classes, tokens resolve to Aetherium values.

7. Verify focus ring contrast: `#4eddb6` against `#101419` = ~10:1 ratio (passes WCAG 2.1 AAA). No change needed.
8. **Result:** All components use semantic tokens only. Aetherium palette takes effect globally.

### Phase 2: New Component Primitives

Build in order (each depends on previous):
1. `GlassCard.tsx` (standalone)
2. `StatusBadge.tsx` (standalone)
3. `MetricCard.tsx` (uses GlassCard)
4. `TabbedPanel.tsx` (standalone)
5. `ProgressStepper.tsx` (standalone)
6. `TerminalPanel.tsx` (standalone)
7. `ActionBar.tsx` (uses Button)
8. `StageColumn.tsx` (uses GlassCard)

Each gets a co-located `.test.tsx` file.

### Phase 3: Restyle Existing Components

Incremental updates, one component at a time:
1. Sidebar — glass bg, nav item styling
2. TaskCard — GlassCard wrapper, StatusBadge, ProgressStepper
3. TopBar — glass surface, heading font
4. Button — updated hover/focus colors
5. Toast — glass background, border colors

### Phase 4: Style Guide Route

1. Create `DesignSystem.tsx`
2. Add sidebar nav link
3. Add lazy-loaded route in `App.tsx`

---

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Semantic color shift (blue→teal) | Users see different primary action color | Intentional — Aetherium identity. Document in changelog. |
| Glass blur performance | Backdrop-filter can be expensive | Only apply to key surfaces (cards, sidebar, topbar), not every element |
| Font loading flash | FOUT with 3 font families | Use `font-display: swap`, preload critical fonts |
| Existing test snapshots | Visual tests may fail | Update baselines after Phase 1 token swap |
| Focus ring color shift | Focus indicators change from blue to teal | Verified: #4eddb6 on #101419 = ~10:1 contrast (WCAG AAA) |
| Hard-coded Tailwind colors | Components bypass semantic tokens | Audit in Phase 1 — replace all raw `blue-*`/`purple-*` with semantic classes |

## Files Changed

### New Files
- `ui/src/components/GlassCard.tsx`
- `ui/src/components/GlassCard.test.tsx`
- `ui/src/components/StatusBadge.tsx`
- `ui/src/components/StatusBadge.test.tsx`
- `ui/src/components/MetricCard.tsx`
- `ui/src/components/MetricCard.test.tsx`
- `ui/src/components/TabbedPanel.tsx`
- `ui/src/components/TabbedPanel.test.tsx`
- `ui/src/components/ProgressStepper.tsx`
- `ui/src/components/ProgressStepper.test.tsx`
- `ui/src/components/TerminalPanel.tsx`
- `ui/src/components/TerminalPanel.test.tsx`
- `ui/src/components/ActionBar.tsx`
- `ui/src/components/ActionBar.test.tsx`
- `ui/src/components/StageColumn.tsx`
- `ui/src/components/StageColumn.test.tsx`
- `ui/src/components/DesignSystem.tsx`
- `ui/src/components/DesignSystem.test.tsx`

### Modified Files
- `ui/src/app.css` — Full token replacement
- `ui/index.html` — Google Fonts imports
- `ui/src/App.tsx` — New `/design-system` route
- `ui/src/components/Sidebar.tsx` — Glass bg, nav link, styling
- `ui/src/components/TaskCard.tsx` — GlassCard, StatusBadge, ProgressStepper
- `ui/src/components/TopBar.tsx` — Glass surface, heading font
- `ui/src/components/Button.tsx` — Updated hover/focus colors
- `ui/src/components/Toast.tsx` — Glass bg, border colors

### Additional Modified Files (Phase 1 hard-coded color audit)
- `ui/src/components/StageAccordion.tsx` — Replace `hover:bg-blue-600`
- `ui/src/components/StageRow.tsx` — Replace `hover:bg-blue-600`
- `ui/src/components/TaskForm.tsx` — Replace `hover:bg-blue-600` (2 instances)
- `ui/src/components/Settings.tsx` — Replace `hover:bg-blue-600`
- `ui/src/components/ErrorBoundary.tsx` — Replace `hover:bg-blue-600`
- `ui/src/components/BlockedPanel.tsx` — Replace `bg-blue-*` risk badge classes
- `ui/src/components/CostDashboard.tsx` — Replace `bg-blue-500`, `bg-purple-500` stage colors
- `ui/src/components/EventsTimeline.tsx` — Replace `bg-purple-*`, `bg-blue-*` status badges

### Notes

- **Spacing:** Uses Tailwind's default spacing scale (no custom overrides).
- **`--font-heading`** is registered in the `@theme` block so Tailwind generates a `font-heading` utility class, usable as `className="font-heading"`.
- **New semantic hover token:** `--color-accent-blue-hover` maps to `--aeth-primary-container` (#64f0c8) for consistent hover states on primary action elements.
