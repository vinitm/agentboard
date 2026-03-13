# UI Overhaul Design Spec

**Date:** 2026-03-13
**Goal:** Transform the Agentboard UI from a utilitarian inline-styled app into a Linear-inspired, polished dev tool that serves as both a monitoring dashboard and an interactive workspace.
**Approach:** Tailwind CSS + Headless UI (Radix primitives) — dark-first theme, accessible components, utility-class styling.

---

## 1. Design System Foundation

### 1.1 Tailwind Setup

Install Tailwind CSS v4 with Vite integration. Remove all inline `style={}` objects across every component and replace with Tailwind utility classes.

Remove the existing `styles.css` file and replace with a Tailwind entry point that defines custom design tokens.

### 1.2 Color Palette (CSS Variables via Tailwind)

Dark-first theme inspired by Linear. All colors defined as CSS custom properties so light mode can be added later.

```
--bg-primary:     #0a0a0b    (app background)
--bg-secondary:   #111113    (sidebar, cards)
--bg-tertiary:    #1a1a1e    (column backgrounds, hover states)
--bg-elevated:    #1e1e22    (modals, dropdowns, active items)

--border-default: #1e1e22    (subtle borders)
--border-hover:   #2e2e33    (interactive borders)

--text-primary:   #e5e7eb    (main text)
--text-secondary: #9ca3af    (secondary/muted text)
--text-tertiary:  #7c8493    (labels, counts — adjusted for WCAG AA on --bg-tertiary)

--accent-blue:    #3b82f6    (primary actions, links)
--accent-green:   #22c55e    (success, done, running)
--accent-amber:   #f59e0b    (warnings, blocked)
--accent-red:     #ef4444    (errors, failed, destructive actions)
--accent-purple:  #8b5cf6    (agent-active stages)
--accent-pink:    #ec4899    (needs human review)
```

### 1.3 Typography

- Font: `Inter` via CDN (Linear uses Inter). Fallback to system font stack.
- Base size: 14px
- Headings: font-weight 600, tracked slightly tighter
- Monospace (logs, code): `JetBrains Mono` or `ui-monospace` fallback

### 1.4 Spacing & Sizing

Use Tailwind's default spacing scale. Key conventions:
- Page padding: `p-5` (20px)
- Card padding: `p-3` (12px)
- Gap between cards: `gap-2` (8px)
- Border radius: `rounded-lg` (8px) for cards, `rounded-xl` (12px) for modals
- Column width: `w-72` (288px)

### 1.5 Transitions

All interactive elements get `transition-colors duration-150`. Drag overlays get `transition-shadow duration-150`.

---

## 2. Layout & Navigation

### 2.1 App Shell

Replace the current header-only layout with a sidebar + main content layout.

```
┌─────────────────────────────────────────────┐
│ [Sidebar]  │  [Top Bar]                     │
│            │────────────────────────────────│
│ Agentboard │                                │
│            │  [Main Content Area]           │
│ ▦ Board    │                                │
│ ◷ Activity │  (Board / TaskPage / Settings) │
│            │                                │
│ ─────────  │                                │
│ PROJECTS   │                                │
│ ● my-repo  │                                │
│ ○ other    │                                │
│            │                                │
│ ─────────  │                                │
│ ⚙ Settings │                                │
└─────────────────────────────────────────────┘
```

**Sidebar (240px, collapsible to 48px icon bar):**
- Logo/wordmark at top
- Navigation: Board, Activity (new), Settings
- Projects section: list all registered projects, click to switch. Active project has a filled dot indicator.
- Collapse toggle at bottom (Cmd+B / Ctrl+B keyboard shortcut)
- Background: `--bg-secondary`
- Active item: `--bg-elevated` background with white text
- Inactive items: `--text-secondary`

**Top Bar (contextual):**
- Shows current view name (e.g., "Board") + task count badge
- Right side: Filter button, Search (Cmd+K), + New Task button
- Background: `--bg-primary` with bottom border `--border-default`

### 2.2 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Open search/command palette |
| `Cmd+B` | Toggle sidebar |
| `N` | New task (when not in input) |
| `Esc` | Close modal/panel |

Implement with a simple `useEffect` keydown listener in App.tsx — no library needed.

### 2.3 Command Palette (Cmd+K)

A Radix Dialog with a search input at top. Searches across:
- Task titles (navigate to task)
- Actions ("New task", "Settings", "Switch to [project]")

Styled as a floating overlay, similar to Linear's command palette.

**Scope:** The command palette is explicitly deferred to a follow-up iteration. It is not part of this implementation plan. The `Cmd+K` shortcut should be wired up to show a placeholder "Coming soon" toast for now.

---

## 3. Kanban Board

### 3.1 Column Layout

Keep horizontal scrolling but improve the visual treatment:
- Column background: `--bg-tertiary` with `rounded-lg`
- Column header: uppercase label, task count badge, sticky at top
- Agent-active columns (planning, implementing, checks, review_spec, review_code): left border accent in `--accent-purple`
- Empty columns: show a subtle dashed drop zone
- Extra columns (blocked, failed, cancelled): render inline with main columns but only when populated, with distinct header color matching their status

### 3.2 Task Cards

Redesign cards for dark theme with more information density:

```
┌─────────────────────────────┐
│ Add authentication flow     │
│                             │
│ ● low   P2   ⏱ 3m ago     │
│                             │
│ ▶ 2/4 subtasks done         │
└─────────────────────────────┘
```

- Background: `--bg-secondary`
- Border: `--border-default`, with left accent border for status:
  - Agent-active (claimed): `--accent-purple`
  - Needs human review: `--accent-pink`
  - Blocked: `--accent-amber`
  - Failed: `--accent-red`
  - Default: transparent
- Title: `--text-primary`, font-weight 500, truncate to 2 lines max
- Meta row: risk level dot (colored, not badge), priority, relative time
- Running indicator: replace "running" text pulse with a small animated spinner icon next to the status dot
- Subtask progress: mini progress bar (colored segments) instead of just text
- Hover: `--bg-tertiary` background, slight border brightening
- Selected (checkbox): `--accent-blue` ring

### 3.3 Drag & Drop

Keep @dnd-kit but improve visual feedback:
- Drag overlay: card with `shadow-2xl`, slight rotation (keep current 2deg), `opacity-90`
- Drop target: column gets a `ring-2 ring-blue-500` outline instead of background color change
- Smooth transitions on card reflow

### 3.4 Action Bar

Merge the "+ New Task" button and bulk actions into the top bar:
- "+ New Task" moves to the top bar (right side)
- Bulk action bar appears below the top bar as a contextual banner when tasks are selected
- Styled with `--bg-elevated` background, pill-shaped action buttons

### 3.5 Filtering

Add a filter popover (Radix Popover) accessible from the top bar:
- Filter by status (multi-select checkboxes)
- Filter by risk level
- Filter by "has subtasks" (uses existing `parentTaskId` field — subtask nesting is already implemented)
- Filter by "is running" (checks `claimedBy !== null`)
- Active filters show as pills in the top bar
- Filter state is local React state (not persisted to localStorage or URL). Filters reset on page reload. This keeps the implementation simple — URL-based filters can be added later if needed.

---

## 4. Task Detail

### 4.1 Modal Redesign

Keep as a modal (not full-page — TaskPage already handles the full-page view) but improve:
- Background: `--bg-elevated`
- Max width: 720px
- Sections with clear visual separation using `--border-default` dividers
- Use Radix Dialog for accessible overlay, focus trapping, Esc to close
- Add a "View Details" link that navigates to `/tasks/:id` (already exists, keep it)

### 4.2 Section Layout

```
┌──────────────────────────────────────┐
│ Task Title                    [×]    │
│ implementing · medium risk · P2      │
│──────────────────────────────────────│
│ Description                          │
│ (rendered text)                      │
│──────────────────────────────────────│
│ Spec                                 │
│ Context: ...                         │
│ Acceptance Criteria: ...             │
│──────────────────────────────────────│
│ [Blocked Panel / PR Panel / Logs]    │
│──────────────────────────────────────│
│ Runs (3)                             │
│ (collapsible run history)            │
│──────────────────────────────────────│
│ [Edit] [Delete]        View Details →│
└──────────────────────────────────────┘
```

- Status/risk/priority shown as inline text badges (not large colored blocks)
- Spec fields shown in a subtle grid layout
- Live logs section only when agent is active
- Actions pinned to bottom of modal

### 4.3 Blocked Panel

- Prominent amber border top
- Question displayed in a callout box
- Textarea for human answer with placeholder text
- Submit button with loading state

### 4.4 PR Panel

- Show PR link as a clickable card with GitHub icon
- "Mark as Done" as a green confirmation button

---

## 5. Task Page (Full-Page View)

### 5.1 Layout

Keep the existing three-tab structure (Logs, Events, Runs) but adapt to dark theme:
- Header: task title, status badge, risk badge, priority, action buttons — all on dark background
- Tab bar: underline-style tabs with `--accent-blue` active indicator
- Content area: full remaining height, scrollable

### 5.2 Log Viewer

Keep the existing Catppuccin-inspired dark terminal theme (it already matches the new dark-first direction). Improvements:
- Add a "Clear" button and "Auto-scroll" toggle
- Show log source/stage as colored prefix labels
- Monospace font: `JetBrains Mono` or `ui-monospace`

### 5.3 Events Timeline

Keep existing timeline component, adapt colors to dark theme palette.

### 5.4 Run History

Adapt to dark theme. Each run shown as a row with:
- Stage label (colored)
- Status badge
- Duration
- Token count
- Model used
- Expandable input/output sections

---

## 6. Settings

### 6.1 Move to Sidebar Route

Settings becomes a full page accessible from sidebar instead of a modal overlay. Route: `/settings`.

This means the current `Settings` component changes its interface: the `onClose` prop is removed, and the overlay/modal wrapper is removed. The component becomes a standard routed page component. The `showSettings` state in `App.tsx` is removed and replaced by React Router navigation.

Note: React Router (`react-router-dom`) is already installed and in use — `App.tsx` uses `BrowserRouter`, `Routes`, and `Route`, and `TaskPage`/`TaskDetail` use `Link` and `useParams`. Adding `/settings` and `/activity` routes is straightforward.

### 6.2 Layout

Two-column layout on the settings page:
- Left: navigation between settings sections (Commands, Security, Budgets, Branch & PR, Policies, Models, Notifications)
- Right: the settings form for the active section

### 6.3 Form Styling

- Input fields: dark background `--bg-tertiary`, border `--border-default`, focus ring `--accent-blue`
- Selects: same treatment, using Radix Select for better styling control
- Checkboxes: custom styled with `--accent-blue`
- Section headers: uppercase, `--text-tertiary`
- Save button: sticky bottom bar with unsaved changes indicator

---

## 7. Activity Feed (New)

A new route `/activity` accessible from the sidebar. Shows a reverse-chronological feed of all task events across the active project.

### 7.1 Feed Items

Each item shows:
- Timestamp (relative)
- Event type icon
- Task title (linked)
- Event description (e.g., "moved to implementing", "check failed: lint", "PR created")

### 7.2 Filtering

- Filter by event type
- Filter by task

### 7.3 Data Source

Requires a new backend endpoint: `GET /api/events?projectId=<id>&limit=50&cursor=<lastEventId>`.

The existing `/api/events` endpoint only supports `taskId` as a filter. A new database query `listEventsByProject(projectId, limit, cursor)` must be added that joins events with tasks to filter by project. Returns events in reverse-chronological order.

**Pagination:** Cursor-based using the event `id` (auto-incrementing). Initial load fetches 50 events. A "Load more" button fetches the next page.

**Real-time updates:** WebSocket `task:event` messages append new events to the top. The frontend filters client-side: it maintains a set of task IDs belonging to the active project (already available via the `useTasks` hook) and only appends events whose `taskId` matches.

**Database join:** The events table has a `taskId` column. Tasks have a `projectId` column. The new query joins `events.taskId = tasks.id` and filters by `tasks.projectId`. Returns events in reverse-chronological order (`ORDER BY events.id DESC`).

**Response shape:** `{ id, taskId, runId, type, payload, createdAt, taskTitle }` — the `taskTitle` is joined from the tasks table to avoid N+1 lookups on the frontend.

---

## 8. Real-Time Feedback

### 8.1 Toast Notifications

Add a toast notification system (bottom-right corner) for:
- Task status changes ("Task X moved to implementing")
- Agent completion ("Task X checks passed")
- Errors ("Task X failed at checks stage")

Use Radix Toast for accessible, auto-dismissing notifications.

### 8.2 Sidebar Activity Indicator

Show a small animated dot next to "Board" in the sidebar when any task is actively running. Shows how many tasks are running.

### 8.3 Column Activity Indicators

Agent-active columns with running tasks show a subtle animated accent (border pulse or dot animation) to draw attention.

---

## 9. Responsive Considerations

### 9.1 Minimum Viable Responsive

This is a dev tool primarily used on desktop. Full mobile responsiveness is not a priority, but:
- Sidebar collapses to icon bar below 1024px
- Board columns scroll horizontally (already works)
- Modals become near-full-screen on narrow viewports
- Settings uses single-column layout on narrow viewports

### 9.2 Scrollbar Styling

Replace webkit-only scrollbar styles with Tailwind's `scrollbar` plugin or a thin custom scrollbar that works cross-browser. Match dark theme colors.

---

## 10. Accessibility

### 10.1 Radix Primitives

Use Radix UI for all interactive overlay components:
- `@radix-ui/react-dialog` — modals (TaskDetail, TaskForm)
- `@radix-ui/react-popover` — filter popover
- `@radix-ui/react-select` — styled selects (Settings)
- `@radix-ui/react-toast` — notifications
- `@radix-ui/react-tooltip` — hover tooltips for truncated text and icons

These provide built-in ARIA attributes, focus trapping, keyboard navigation.

### 10.2 Keyboard Navigation

- All interactive elements focusable via Tab
- Esc closes modals and popovers
- Enter/Space activates buttons and selections
- Arrow keys navigate within selects and menus

### 10.3 Color Contrast

Text/background combinations target WCAG AA contrast ratios (4.5:1 for normal text). Key pairings:
- `--text-primary` (#e5e7eb) on `--bg-primary` (#0a0a0b): ~16:1 (passes)
- `--text-secondary` (#9ca3af) on `--bg-primary` (#0a0a0b): ~8:1 (passes)
- `--text-tertiary` (#7c8493) on `--bg-primary` (#0a0a0b): ~6.2:1 (passes)
- `--text-tertiary` (#7c8493) on `--bg-tertiary` (#1a1a1e): ~4.6:1 (passes AA)

---

## 11. Migration Strategy

### 11.1 Dependencies to Add

```
tailwindcss @tailwindcss/vite    (Tailwind v4 + Vite plugin)
@radix-ui/react-dialog
@radix-ui/react-popover
@radix-ui/react-select
@radix-ui/react-toast
@radix-ui/react-tooltip
```

### 11.2 Migration Order

1. **Foundation**: Install Tailwind, configure theme, set up CSS entry point, add Inter font
2. **App Shell**: Build sidebar + top bar layout in App.tsx (replaces header)
3. **Board**: Convert Column and TaskCard to Tailwind, add dark theme
4. **Task Detail Modal**: Convert to Radix Dialog + Tailwind
5. **Task Form Modal**: Convert to Radix Dialog + Tailwind
6. **Settings Page**: Move from modal to route, convert to Tailwind
7. **Task Page**: Convert to dark theme Tailwind
8. **Log Viewer**: Minor tweaks (already dark)
9. **Events Timeline**: Convert to dark theme
10. **Run History**: Convert to dark theme
11. **New Features**: Toast notifications, activity feed (requires new backend endpoint)
12. **Polish**: Keyboard shortcuts, filters, responsive tweaks

### 11.3 Files Affected

Every component file in `ui/src/components/` will be modified to replace inline styles with Tailwind classes. No new component files are needed except:
- `ui/src/components/Sidebar.tsx` — new sidebar component
- `ui/src/components/TopBar.tsx` — new contextual top bar
- `ui/src/components/Toast.tsx` — toast notification wrapper
- `ui/src/components/ActivityFeed.tsx` — new activity feed page

Note: `CommandPalette.tsx` is deferred to a follow-up iteration and not created in this plan.

### 11.4 Files to Remove

- `ui/src/styles.css` — replaced by Tailwind entry point

---

## 12. Out of Scope

- Light mode toggle (foundation supports it via CSS variables, but only dark ships first)
- Mobile-native layout
- User accounts / multi-user features
- Internationalization
- Custom themes
