# UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Agentboard UI into a Linear-inspired dark-themed dev tool using Tailwind CSS v4 + Radix UI primitives.

**Architecture:** Replace all inline styles with Tailwind utility classes. Add a collapsible sidebar + contextual top bar layout. Use Radix UI for accessible overlays (Dialog, Popover, Toast, Select, Tooltip). Add activity feed with new backend endpoint. Dark-first theme with CSS custom properties.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v4, @tailwindcss/vite, Radix UI, Vite 6, react-router-dom 7, @dnd-kit, socket.io-client

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `ui/src/app.css` | Tailwind entry point with `@import "tailwindcss"`, custom theme CSS variables, font imports, scrollbar styles, keyframe animations |
| `ui/src/components/Sidebar.tsx` | Collapsible sidebar: logo, nav links (Board, Activity, Settings), project switcher, collapse toggle |
| `ui/src/components/TopBar.tsx` | Contextual top bar: view title, task count badge, filter button, "+ New Task" button |
| `ui/src/components/Toast.tsx` | Radix Toast provider + `useToast` hook for app-wide notifications |
| `ui/src/components/FilterPopover.tsx` | Radix Popover with status/risk/running filters, local state |
| `ui/src/components/ActivityFeed.tsx` | `/activity` route: project-wide event feed with cursor pagination + WS live updates |
| `src/db/queries.ts` | Add `listEventsByProject()` function (modify existing file) |
| `src/server/routes/events.ts` | Add `projectId` query parameter support (modify existing file) |

### Modified Files

| File | Changes |
|------|---------|
| `ui/package.json` | Add tailwindcss, @tailwindcss/vite, and 5 @radix-ui packages |
| `ui/vite.config.ts` | Register @tailwindcss/vite plugin |
| `ui/index.html` | Add Inter + JetBrains Mono font links |
| `ui/src/main.tsx` | Import `app.css` instead of `styles.css` |
| `ui/src/App.tsx` | Replace header with Sidebar + TopBar layout, add /settings and /activity routes, add keyboard shortcut listeners, add Toast provider |
| `ui/src/components/Board.tsx` | Convert to Tailwind, remove action bar (moves to TopBar), receive filter state |
| `ui/src/components/Column.tsx` | Convert to Tailwind dark theme, add drop target ring, agent-active accent |
| `ui/src/components/TaskCard.tsx` | Convert to Tailwind dark theme, add subtask progress bar, spinner indicator |
| `ui/src/components/TaskDetail.tsx` | Convert to Radix Dialog + Tailwind dark theme |
| `ui/src/components/TaskForm.tsx` | Convert to Radix Dialog + Tailwind dark theme |
| `ui/src/components/BlockedPanel.tsx` | Convert to Tailwind dark theme |
| `ui/src/components/PRPanel.tsx` | Convert to Tailwind dark theme |
| `ui/src/components/Settings.tsx` | Convert from modal to routed page, Tailwind dark theme, Radix Select |
| `ui/src/components/TaskPage.tsx` | Convert to Tailwind dark theme |
| `ui/src/components/LogViewer.tsx` | Convert inline styles to Tailwind, add Clear + Auto-scroll toggle |
| `ui/src/components/EventsTimeline.tsx` | Convert to Tailwind dark theme |
| `ui/src/components/RunHistory.tsx` | Convert to Tailwind dark theme |

### Deleted Files

| File | Reason |
|------|--------|
| `ui/src/styles.css` | Replaced by `ui/src/app.css` |

---

## Chunk 1: Foundation & App Shell

### Task 1: Install Dependencies and Configure Tailwind

**Files:**
- Modify: `ui/package.json`
- Modify: `ui/vite.config.ts`
- Create: `ui/src/app.css`
- Modify: `ui/src/main.tsx`
- Modify: `ui/index.html`
- Delete: `ui/src/styles.css`

- [ ] **Step 1: Install Tailwind CSS v4 and Radix UI packages**

```bash
cd ui && npm install tailwindcss @tailwindcss/vite @radix-ui/react-dialog @radix-ui/react-popover @radix-ui/react-select @radix-ui/react-toast @radix-ui/react-tooltip
```

- [ ] **Step 2: Register @tailwindcss/vite plugin in vite.config.ts**

Replace `ui/vite.config.ts` with:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:4200',
      '/socket.io': {
        target: 'http://localhost:4200',
        ws: true,
      },
    },
  },
});
```

- [ ] **Step 3: Create `ui/src/app.css` with Tailwind import and theme tokens**

```css
@import "tailwindcss";

@theme {
  --color-bg-primary: #0a0a0b;
  --color-bg-secondary: #111113;
  --color-bg-tertiary: #1a1a1e;
  --color-bg-elevated: #1e1e22;

  --color-border-default: #1e1e22;
  --color-border-hover: #2e2e33;

  --color-text-primary: #e5e7eb;
  --color-text-secondary: #9ca3af;
  --color-text-tertiary: #7c8493;

  --color-accent-blue: #3b82f6;
  --color-accent-green: #22c55e;
  --color-accent-amber: #f59e0b;
  --color-accent-red: #ef4444;
  --color-accent-purple: #8b5cf6;
  --color-accent-pink: #ec4899;

  --font-sans: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'Fira Code', monospace;
}

/* Scrollbar styling */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-hover) transparent;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--color-border-hover);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-tertiary);
}

/* Animations */
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@utility animate-pulse-dot {
  animation: pulse-dot 2s ease-in-out infinite;
}

@utility animate-spin-slow {
  animation: spin 1.5s linear infinite;
}
```

- [ ] **Step 4: Add font links to `ui/index.html`**

Add to `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

- [ ] **Step 5: Update `ui/src/main.tsx` to import `app.css`**

Change `import './styles.css'` to `import './app.css'`.

- [ ] **Step 6: Delete `ui/src/styles.css`**

```bash
rm ui/src/styles.css
```

- [ ] **Step 7: Verify the build compiles**

```bash
cd ui && npx tsc --noEmit && npx vite build
```

Expected: Build succeeds. Existing inline styles still render (Tailwind doesn't break them).

- [ ] **Step 8: Commit**

```bash
git add -A ui/src/app.css ui/src/main.tsx ui/vite.config.ts ui/index.html ui/package.json ui/package-lock.json
git rm ui/src/styles.css
git commit -m "feat(ui): install Tailwind v4, Radix UI, configure theme tokens and fonts"
```

---

### Task 2: Create Sidebar Component

**Files:**
- Create: `ui/src/components/Sidebar.tsx`

- [ ] **Step 1: Create `ui/src/components/Sidebar.tsx`**

```tsx
import React from 'react';
import { NavLink } from 'react-router-dom';
import type { Project } from '../types';

interface Props {
  projects: Project[];
  activeProjectId: string;
  onProjectChange: (id: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  runningCount: number;
}

export const Sidebar: React.FC<Props> = ({
  projects,
  activeProjectId,
  onProjectChange,
  collapsed,
  onToggleCollapse,
  runningCount,
}) => {
  const navItems = [
    { to: '/', label: 'Board', icon: '▦' },
    { to: '/activity', label: 'Activity', icon: '◷' },
    { to: '/settings', label: 'Settings', icon: '⚙' },
  ];

  return (
    <aside
      className={`flex flex-col bg-bg-secondary border-r border-border-default h-screen flex-shrink-0 transition-[width] duration-200 ${
        collapsed ? 'w-12' : 'w-60'
      }`}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-4">
        {!collapsed && (
          <span className="text-sm font-bold text-text-primary tracking-tight">
            Agentboard
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-0.5 px-2">
        {navItems.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] transition-colors duration-150 ${
                isActive
                  ? 'bg-bg-elevated text-white font-medium'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
              }`
            }
          >
            <span className="w-5 text-center opacity-60">{icon}</span>
            {!collapsed && (
              <>
                <span>{label}</span>
                {label === 'Board' && runningCount > 0 && (
                  <span className="ml-auto flex items-center gap-1 text-[11px] text-accent-green">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse-dot" />
                    {runningCount}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Projects */}
      {!collapsed && (
        <div className="mt-6 px-2">
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
            Projects
          </div>
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => onProjectChange(p.id)}
              className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-[13px] text-left transition-colors duration-150 ${
                p.id === activeProjectId
                  ? 'bg-bg-elevated text-white'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  p.id === activeProjectId ? 'bg-accent-blue' : 'bg-text-tertiary'
                }`}
              />
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Collapse toggle */}
      <div className="mt-auto px-2 py-3">
        <button
          onClick={onToggleCollapse}
          className="flex items-center justify-center w-full py-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary transition-colors duration-150 text-xs"
          title={collapsed ? 'Expand sidebar (⌘B)' : 'Collapse sidebar (⌘B)'}
        >
          {collapsed ? '→' : '← Collapse'}
        </button>
      </div>
    </aside>
  );
};
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ui && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/Sidebar.tsx
git commit -m "feat(ui): add Sidebar component with nav, project switcher, collapse"
```

---

### Task 3: Create TopBar Component

**Files:**
- Create: `ui/src/components/TopBar.tsx`

- [ ] **Step 1: Create `ui/src/components/TopBar.tsx`**

```tsx
import React from 'react';

interface Props {
  title: string;
  taskCount?: number;
  onNewTask?: () => void;
  onFilterClick?: () => void;
  activeFilterCount?: number;
  children?: React.ReactNode; // slot for bulk action bar
}

export const TopBar: React.FC<Props> = ({
  title,
  taskCount,
  onNewTask,
  onFilterClick,
  activeFilterCount = 0,
  children,
}) => {
  return (
    <div className="flex-shrink-0">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border-default bg-bg-primary">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {taskCount !== undefined && (
            <span className="text-[11px] text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded">
              {taskCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onFilterClick && (
            <button
              onClick={onFilterClick}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] border border-border-hover rounded-md text-text-secondary hover:text-text-primary hover:border-text-tertiary transition-colors duration-150"
            >
              Filter
              {activeFilterCount > 0 && (
                <span className="bg-accent-blue text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                  {activeFilterCount}
                </span>
              )}
            </button>
          )}
          {onNewTask && (
            <button
              onClick={onNewTask}
              className="px-3 py-1.5 text-[13px] font-semibold bg-accent-blue text-white rounded-md hover:bg-blue-600 transition-colors duration-150"
            >
              + New Task
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
};
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ui && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/TopBar.tsx
git commit -m "feat(ui): add TopBar component with title, filter button, new task action"
```

---

### Task 4: Create Toast Notification System

**Files:**
- Create: `ui/src/components/Toast.tsx`

- [ ] **Step 1: Create `ui/src/components/Toast.tsx`**

```tsx
import React, { createContext, useContext, useState, useCallback } from 'react';
import * as RadixToast from '@radix-ui/react-toast';

type ToastVariant = 'default' | 'success' | 'error' | 'warning';

interface ToastMessage {
  id: string;
  title: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (title: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  default: 'border-border-hover',
  success: 'border-accent-green',
  error: 'border-accent-red',
  warning: 'border-accent-amber',
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((title: string, variant: ToastVariant = 'default') => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, title, variant }]);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      <RadixToast.Provider swipeDirection="right" duration={4000}>
        {children}
        {toasts.map((t) => (
          <RadixToast.Root
            key={t.id}
            onOpenChange={(open) => {
              if (!open) removeToast(t.id);
            }}
            className={`bg-bg-elevated border ${VARIANT_CLASSES[t.variant]} rounded-lg px-4 py-3 shadow-lg`}
          >
            <RadixToast.Title className="text-[13px] text-text-primary">
              {t.title}
            </RadixToast.Title>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed bottom-4 right-4 flex flex-col gap-2 w-80 z-[2000]" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
};
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ui && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/Toast.tsx
git commit -m "feat(ui): add Toast notification system with Radix Toast"
```

---

### Task 5: Rewrite App.tsx with Sidebar + TopBar Layout

**Files:**
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Rewrite `ui/src/App.tsx`**

Replace the entire file with the new sidebar + top bar layout. Key changes:
- Remove `<header>` element and `showSettings` state
- Add `<Sidebar>` and `<TopBar>` components
- Add sidebar collapse state (`sidebarCollapsed`)
- Add keyboard shortcuts (`Cmd+B` for sidebar, `N` for new task, `Cmd+K` for toast placeholder)
- Add `/settings` and `/activity` routes
- Wrap everything in `<ToastProvider>`
- Compute `runningCount` from tasks (tasks with `claimedBy !== null`)

```tsx
import React, { useEffect, useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Board } from './components/Board';
import { Settings } from './components/Settings';
import { TaskPage } from './components/TaskPage';
import { ActivityFeed } from './components/ActivityFeed';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { ToastProvider, useToast } from './components/Toast';
import { useTasks } from './hooks/useTasks';
import { api } from './api/client';
import type { Project } from './types';

const AppContent: React.FC = () => {
  const [projectId, setProjectId] = useState<string>('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [initError, setInitError] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const { toast } = useToast();
  const location = useLocation();

  const { tasks, loading, createTask, updateTask, moveTask, deleteTask, answerTask, retryTask } =
    useTasks(projectId);

  const runningCount = tasks.filter((t) => t.claimedBy).length;

  // Load projects
  useEffect(() => {
    (async () => {
      try {
        const list = await api.get<Project[]>('/api/projects');
        setProjects(list);
        if (list.length > 0) setProjectId(list[0].id);
      } catch (err) {
        setInitError(err instanceof Error ? err.message : 'Failed to load projects');
      }
    })();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toast('Command palette coming soon', 'default');
      }
      if (e.key === 'n' && !isInput && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShowNewTask(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toast]);

  // Determine current view title
  const getTitle = () => {
    if (location.pathname === '/settings') return 'Settings';
    if (location.pathname === '/activity') return 'Activity';
    if (location.pathname.startsWith('/tasks/')) return 'Task Details';
    return 'Board';
  };

  const isBoard = location.pathname === '/';

  return (
    <div className="flex h-screen bg-bg-primary font-sans text-text-primary">
      <Sidebar
        projects={projects}
        activeProjectId={projectId}
        onProjectChange={setProjectId}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        runningCount={runningCount}
      />
      <div className="flex flex-col flex-1 min-w-0">
        {initError ? (
          <div className="flex items-center justify-center flex-1 text-accent-red">
            {initError}
            <div className="mt-2 text-sm text-text-secondary">
              Make sure the API server is running on port 4200
            </div>
          </div>
        ) : !projectId ? (
          <div className="flex flex-col items-center justify-center flex-1 text-text-secondary">
            <div className="text-base font-semibold mb-2">No repos registered</div>
            <div className="text-sm">
              Run <code className="bg-bg-tertiary px-1.5 py-0.5 rounded text-text-primary">agentboard init</code> in
              a repo to register it, then restart the server.
            </div>
          </div>
        ) : (
          <>
            <TopBar
              title={getTitle()}
              taskCount={isBoard ? tasks.length : undefined}
              onNewTask={isBoard ? () => setShowNewTask(true) : undefined}
            />
            <div className="flex-1 overflow-auto">
              <Routes>
                <Route
                  path="/"
                  element={
                    <Board
                      tasks={tasks}
                      loading={loading}
                      createTask={createTask}
                      updateTask={updateTask}
                      moveTask={moveTask}
                      deleteTask={deleteTask}
                      answerTask={answerTask}
                      retryTask={retryTask}
                      showNewTask={showNewTask}
                      onCloseNewTask={() => setShowNewTask(false)}
                    />
                  }
                />
                <Route path="/tasks/:id" element={<TaskPage />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/activity" element={<ActivityFeed projectId={projectId} tasks={tasks} />} />
              </Routes>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export const App: React.FC = () => (
  <BrowserRouter>
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  </BrowserRouter>
);
```

Note: This changes the `Board` component props to accept `showNewTask` and `onCloseNewTask` instead of managing the "new task" state internally. The `Settings` component no longer receives `onClose`. `ActivityFeed` receives `projectId` and `tasks`. These component interface changes are implemented in later tasks.

- [ ] **Step 2: Verify it compiles (expect some type errors for changed interfaces)**

```bash
cd ui && npx tsc --noEmit 2>&1 | head -20
```

Expected: Module-not-found errors for `ActivityFeed` (created in Task 18) and type errors for `Board` and `Settings` interface changes (resolved in later tasks). The dev server will not fully compile until all components are converted — this is expected intermediate breakage.

- [ ] **Step 3: Commit**

```bash
git add ui/src/App.tsx
git commit -m "feat(ui): rewrite App.tsx with sidebar + top bar layout, keyboard shortcuts, toast"
```

---

## Chunk 2: Board Components (Column, TaskCard, Board)

### Task 6: Convert TaskCard to Tailwind Dark Theme

**Files:**
- Modify: `ui/src/components/TaskCard.tsx`

- [ ] **Step 1: Rewrite `ui/src/components/TaskCard.tsx`**

Replace the entire file. Key changes:
- Remove all inline `style={}` objects and `React.CSSProperties` constants
- Use Tailwind utility classes throughout
- Dark theme colors (`bg-bg-secondary`, `border-border-default`, etc.)
- Left accent border based on status (purple for agent-active, amber for blocked, red for failed, pink for needs_human_review)
- Risk level shown as colored dot instead of colored badge
- Relative time display using a `timeAgo()` helper
- Subtask progress bar (colored segments) instead of plain text
- Spinner icon for running tasks instead of pulsing text

```tsx
import React, { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { Task } from '../types';

interface Props {
  task: Task;
  onClick: () => void;
  selected?: boolean;
  subtasks?: Task[];
  onSubtaskClick?: (task: Task) => void;
}

const riskDotColor: Record<string, string> = {
  low: 'bg-accent-green',
  medium: 'bg-accent-amber',
  high: 'bg-accent-red',
};

const statusDotColor: Record<string, string> = {
  done: 'bg-accent-green',
  needs_human_review: 'bg-accent-pink',
  implementing: 'bg-accent-purple',
  checks: 'bg-accent-purple',
  review_spec: 'bg-accent-purple',
  review_code: 'bg-accent-purple',
  planning: 'bg-accent-purple',
  blocked: 'bg-accent-amber',
  failed: 'bg-accent-red',
  ready: 'bg-text-tertiary',
  backlog: 'bg-text-tertiary',
  cancelled: 'bg-text-tertiary',
};

function leftBorderClass(task: Task): string {
  if (task.status === 'blocked') return 'border-l-accent-amber';
  if (task.status === 'failed') return 'border-l-accent-red';
  if (task.status === 'needs_human_review') return 'border-l-accent-pink';
  if (task.claimedBy) return 'border-l-accent-purple';
  return 'border-l-transparent';
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const TaskCard: React.FC<Props> = ({ task, onClick, selected, subtasks = [], onSubtaskClick }) => {
  const [expanded, setExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  const hasSubtasks = subtasks.length > 0;
  const doneCount = subtasks.filter((s) => s.status === 'done').length;
  const subtasksRunning = subtasks.some((s) => s.claimedBy);

  const style: React.CSSProperties = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)${isDragging ? ' rotate(2deg)' : ''}` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`bg-bg-secondary rounded-lg p-3 mb-2 border border-border-default border-l-[3px] ${leftBorderClass(task)} cursor-grab transition-shadow duration-150 ${
        isDragging ? 'shadow-2xl opacity-85' : 'shadow-sm hover:bg-bg-tertiary hover:border-border-hover'
      } ${selected ? 'ring-2 ring-accent-blue' : ''}`}
    >
      <div className="text-sm font-medium text-text-primary line-clamp-2 mb-1.5">{task.title}</div>
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className={`w-2 h-2 rounded-full ${riskDotColor[task.riskLevel] || 'bg-text-tertiary'}`} />
        <span className="text-text-tertiary">{task.riskLevel}</span>
        {task.priority > 0 && <span className="text-text-tertiary">P{task.priority}</span>}
        <span className="text-text-tertiary">{timeAgo(task.updatedAt)}</span>
        {task.claimedBy && (
          <span className="flex items-center gap-1 text-accent-purple">
            <svg className="w-3 h-3 animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
            running
          </span>
        )}
        {subtasksRunning && !task.claimedBy && (
          <span className="flex items-center gap-1 text-accent-purple">
            <svg className="w-3 h-3 animate-spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
            subtasks
          </span>
        )}
      </div>

      {/* Subtask progress */}
      {hasSubtasks && (
        <div className="mt-2 pt-2 border-t border-border-default">
          <div
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setExpanded(!expanded); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex items-center gap-2 cursor-pointer text-xs text-text-tertiary select-none"
          >
            <span className={`text-[10px] transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}>▶</span>
            {/* Mini progress bar */}
            <div className="flex-1 h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
              <div
                className="h-full rounded-full bg-accent-green transition-all duration-300"
                style={{ width: `${(doneCount / subtasks.length) * 100}%` }}
              />
            </div>
            <span>{doneCount}/{subtasks.length}</span>
          </div>

          {expanded && (
            <div className="mt-1.5">
              {subtasks
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                .map((sub) => (
                  <div
                    key={sub.id}
                    onClick={(e) => { e.stopPropagation(); onSubtaskClick?.(sub); }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 py-0.5 cursor-pointer text-xs text-text-secondary hover:text-text-primary"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDotColor[sub.status] || 'bg-text-tertiary'}`} />
                    <span className="truncate">{sub.title}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ui && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/TaskCard.tsx
git commit -m "feat(ui): convert TaskCard to Tailwind dark theme with progress bar and spinner"
```

---

### Task 7: Convert Column to Tailwind Dark Theme

**Files:**
- Modify: `ui/src/components/Column.tsx`

- [ ] **Step 1: Rewrite `ui/src/components/Column.tsx`**

Replace the entire file:

```tsx
import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { TaskCard } from './TaskCard';
import type { Task, TaskStatus } from '../types';

const AGENT_COLUMNS: TaskStatus[] = ['planning', 'implementing', 'checks', 'review_spec', 'review_code'];

const COLUMN_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  planning: 'Planning',
  implementing: 'Implementing',
  checks: 'Checks',
  review_spec: 'Review: Spec',
  review_code: 'Review: Code',
  needs_human_review: 'Needs Human Review',
  done: 'Done',
  blocked: 'Blocked',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_HEADER_COLOR: Partial<Record<TaskStatus, string>> = {
  blocked: 'text-accent-amber',
  failed: 'text-accent-red',
  cancelled: 'text-text-tertiary',
};

interface Props {
  status: TaskStatus;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  subtasksByParent?: Map<string, Task[]>;
  onSubtaskClick?: (task: Task) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (taskId: string, event: React.MouseEvent) => void;
}

export const Column: React.FC<Props> = ({ status, tasks, onTaskClick, subtasksByParent, onSubtaskClick, selectedIds, onToggleSelect }) => {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const isAgent = AGENT_COLUMNS.includes(status);
  const hasRunning = tasks.some((t) => t.claimedBy);

  return (
    <div
      ref={setNodeRef}
      className={`w-72 flex-shrink-0 rounded-lg p-2.5 flex flex-col transition-all duration-150 ${
        isOver ? 'ring-2 ring-accent-blue bg-bg-tertiary' : 'bg-bg-tertiary'
      } ${isAgent && hasRunning ? 'border-l-2 border-l-accent-purple' : ''}`}
    >
      <div className="flex items-center justify-between mb-2.5 px-1">
        <span className={`text-xs font-bold uppercase tracking-wide ${STATUS_HEADER_COLOR[status] || (isAgent ? 'text-accent-purple' : 'text-text-secondary')}`}>
          {COLUMN_LABELS[status] || status}
        </span>
        <span className="text-[11px] bg-bg-elevated text-text-tertiary rounded-full px-2 py-0.5 font-semibold">
          {tasks.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto min-h-[60px]">
        {tasks.length === 0 && (
          <div className="border-2 border-dashed border-border-default rounded-lg h-16 flex items-center justify-center text-xs text-text-tertiary">
            Drop here
          </div>
        )}
        {tasks
          .sort((a, b) => a.columnPosition - b.columnPosition || b.priority - a.priority)
          .map((task) => (
            <div key={task.id} className="relative">
              {selectedIds && onToggleSelect && (
                <input
                  type="checkbox"
                  checked={selectedIds.has(task.id)}
                  onClick={(e) => onToggleSelect(task.id, e)}
                  onChange={() => {}}
                  className="absolute top-2 right-2 z-10 cursor-pointer accent-accent-blue"
                />
              )}
              <TaskCard
                task={task}
                onClick={() => onTaskClick(task)}
                selected={selectedIds?.has(task.id)}
                subtasks={subtasksByParent?.get(task.id) || []}
                onSubtaskClick={onSubtaskClick}
              />
            </div>
          ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ui && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/Column.tsx
git commit -m "feat(ui): convert Column to Tailwind dark theme with drop zone and agent accents"
```

---

### Task 8: Convert Board to Tailwind, Update Props Interface

**Files:**
- Modify: `ui/src/components/Board.tsx`

- [ ] **Step 1: Rewrite `ui/src/components/Board.tsx`**

Key changes:
- Remove inline styles, use Tailwind classes
- Accept `showNewTask` and `onCloseNewTask` props (new task trigger moved to TopBar)
- Remove the standalone "+ New Task" button (handled by TopBar now)
- Keep bulk action bar but style with Tailwind
- Keep DndContext and drag overlay

```tsx
import React, { useState } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { Column } from './Column';
import { TaskCard } from './TaskCard';
import { TaskDetail } from './TaskDetail';
import { TaskForm } from './TaskForm';
import type { Task, TaskStatus, RiskLevel } from '../types';

const MAIN_COLUMNS: TaskStatus[] = [
  'backlog', 'ready', 'planning', 'implementing', 'checks',
  'review_spec', 'review_code', 'needs_human_review', 'done',
];

const EXTRA_COLUMNS: TaskStatus[] = ['blocked', 'failed', 'cancelled'];
const MOVABLE_COLUMNS: TaskStatus[] = ['backlog', 'ready', 'cancelled', 'done'];

interface Props {
  tasks: Task[];
  loading: boolean;
  createTask: (data: { title: string; description?: string; spec?: string; riskLevel?: RiskLevel; priority?: number }) => Promise<Task>;
  updateTask: (id: string, data: Partial<Task>) => Promise<Task>;
  moveTask: (id: string, column: TaskStatus) => Promise<Task>;
  deleteTask: (id: string) => Promise<void>;
  answerTask: (id: string, answers: string) => Promise<Task>;
  retryTask: (id: string) => Promise<Task>;
  showNewTask?: boolean;
  onCloseNewTask?: () => void;
}

export const Board: React.FC<Props> = ({
  tasks, loading, createTask, updateTask, moveTask, deleteTask, answerTask, retryTask,
  showNewTask, onCloseNewTask,
}) => {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null | undefined>(undefined);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  // Subtask filtering
  const subtasksByParent = new Map<string, Task[]>();
  const topLevelTasks = tasks.filter((t) => {
    if (t.parentTaskId) {
      const existing = subtasksByParent.get(t.parentTaskId) || [];
      existing.push(t);
      subtasksByParent.set(t.parentTaskId, existing);
      return false;
    }
    return true;
  });

  const tasksByStatus = (status: TaskStatus) => topLevelTasks.filter((t) => t.status === status);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTask((event.active.data.current?.task as Task) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const taskId = active.id as string;
    const overId = over.id as string;
    const isValidColumn = (MAIN_COLUMNS as string[]).includes(overId) || (EXTRA_COLUMNS as string[]).includes(overId);
    const targetColumn = isValidColumn ? (overId as TaskStatus) : tasks.find((t) => t.id === overId)?.status;
    if (!targetColumn) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === targetColumn) return;
    moveTask(taskId, targetColumn).catch((err) => {
      console.error('Move failed:', err);
      alert(`Cannot move task: ${err instanceof Error ? err.message : 'Unknown error'}`);
    });
  };

  const handleCreateOrEdit = async (data: { title: string; description: string; spec: string; riskLevel: RiskLevel; priority: number }) => {
    if (editingTask) {
      await updateTask(editingTask.id, data);
    } else {
      await createTask(data);
    }
    setEditingTask(undefined);
    onCloseNewTask?.();
  };

  const toggleSelect = (taskId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(taskId) ? next.delete(taskId) : next.add(taskId);
      return next;
    });
  };

  const bulkMove = async (column: TaskStatus) => {
    for (const id of selectedIds) {
      try { await moveTask(id, column); } catch (err) { console.error(`Bulk move failed for ${id}:`, err); }
    }
    setSelectedIds(new Set());
  };

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selectedIds.size} selected tasks?`)) return;
    for (const id of selectedIds) {
      try { await deleteTask(id); } catch (err) { console.error(`Bulk delete failed for ${id}:`, err); }
    }
    setSelectedIds(new Set());
  };

  if (loading) {
    return <div className="flex justify-center p-10 text-text-secondary">Loading tasks...</div>;
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="p-4">
        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="mb-3 flex items-center gap-2 bg-bg-elevated rounded-lg px-3 py-2 text-[13px]">
            <span className="font-semibold text-accent-blue">{selectedIds.size} selected</span>
            <select
              onChange={(e) => { if (e.target.value) { bulkMove(e.target.value as TaskStatus); e.target.value = ''; } }}
              className="rounded px-2 py-1 text-xs bg-bg-tertiary border border-border-default text-text-primary"
              defaultValue=""
            >
              <option value="" disabled>Move to...</option>
              {MOVABLE_COLUMNS.map((col) => <option key={col} value={col}>{col}</option>)}
            </select>
            <button onClick={() => bulkMove('cancelled')} className="px-2.5 py-1 rounded text-xs font-semibold bg-accent-amber text-white">Cancel</button>
            <button onClick={bulkDelete} className="px-2.5 py-1 rounded text-xs font-semibold bg-accent-red text-white">Delete</button>
            <button onClick={() => setSelectedIds(new Set())} className="px-2.5 py-1 rounded text-xs border border-border-default text-text-secondary">Clear</button>
          </div>
        )}

        {/* Main columns */}
        <div className="flex gap-2.5 overflow-x-auto pb-3">
          {MAIN_COLUMNS.map((status) => (
            <Column key={status} status={status} tasks={tasksByStatus(status)} onTaskClick={(t) => setSelectedTaskId(t.id)}
              subtasksByParent={subtasksByParent} onSubtaskClick={(t) => setSelectedTaskId(t.id)}
              selectedIds={selectedIds} onToggleSelect={toggleSelect} />
          ))}
        </div>

        {/* Extra columns */}
        <div className="flex gap-2.5 mt-2.5">
          {EXTRA_COLUMNS.map((status) => {
            const colTasks = tasksByStatus(status);
            if (colTasks.length === 0) return null;
            return (
              <Column key={status} status={status} tasks={colTasks} onTaskClick={(t) => setSelectedTaskId(t.id)}
                subtasksByParent={subtasksByParent} onSubtaskClick={(t) => setSelectedTaskId(t.id)}
                selectedIds={selectedIds} onToggleSelect={toggleSelect} />
            );
          })}
        </div>
      </div>

      <DragOverlay>
        {activeTask ? (
          <div className="rotate-[3deg] opacity-90">
            <TaskCard task={activeTask} onClick={() => {}} />
          </div>
        ) : null}
      </DragOverlay>

      {selectedTask && (
        <TaskDetail task={selectedTask} onClose={() => setSelectedTaskId(null)} onUpdate={updateTask}
          onAnswer={answerTask} onRetry={retryTask} onDelete={deleteTask} onMove={moveTask}
          onEdit={(t) => { setSelectedTaskId(null); setEditingTask(t); }} />
      )}

      {(editingTask !== undefined || showNewTask) && (
        <TaskForm
          initial={editingTask}
          onSubmit={handleCreateOrEdit}
          onCancel={() => { setEditingTask(undefined); onCloseNewTask?.(); }}
        />
      )}
    </DndContext>
  );
};
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ui && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/Board.tsx
git commit -m "feat(ui): convert Board to Tailwind, accept showNewTask prop from TopBar"
```

---

## Chunk 3: Modals & Panels

### Task 9: Convert TaskDetail to Radix Dialog + Tailwind

**Files:**
- Modify: `ui/src/components/TaskDetail.tsx`

- [ ] **Step 1: Rewrite `ui/src/components/TaskDetail.tsx`**

Replace entire file. Key changes:
- Wrap in `<Dialog.Root>` / `<Dialog.Portal>` / `<Dialog.Overlay>` / `<Dialog.Content>` from Radix
- All inline styles replaced with Tailwind classes
- Dark theme: `bg-bg-elevated` content, `text-text-primary`
- Status/risk/priority as inline text badges
- Use `Dialog.Close` for the close button
- Keep Link to `/tasks/:id`

```tsx
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from '../api/client';
import { LogViewer } from './LogViewer';
import { BlockedPanel } from './BlockedPanel';
import { PRPanel } from './PRPanel';
import { RunHistory } from './RunHistory';
import type { Task, TaskStatus, Run, SpecTemplate } from '../types';

interface Props {
  task: Task;
  onClose: () => void;
  onUpdate: (id: string, data: Partial<Task>) => Promise<Task>;
  onAnswer: (id: string, answers: string) => Promise<Task>;
  onRetry: (id: string) => Promise<Task>;
  onDelete: (id: string) => Promise<void>;
  onEdit: (task: Task) => void;
  onMove: (id: string, column: TaskStatus) => Promise<Task>;
}

const statusBadgeColor: Record<string, string> = {
  backlog: 'text-text-tertiary', ready: 'text-accent-blue', planning: 'text-accent-purple',
  implementing: 'text-accent-purple', checks: 'text-accent-purple', review_spec: 'text-accent-purple',
  review_code: 'text-accent-purple', needs_human_review: 'text-accent-pink', done: 'text-accent-green',
  blocked: 'text-accent-amber', failed: 'text-accent-red', cancelled: 'text-text-tertiary',
};

const riskTextColor: Record<string, string> = {
  high: 'text-accent-red', medium: 'text-accent-amber', low: 'text-accent-green',
};

export const TaskDetail: React.FC<Props> = ({ task, onClose, onUpdate, onAnswer, onRetry, onDelete, onEdit, onMove }) => {
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    api.get<Run[]>(`/api/runs?taskId=${task.id}`).then(setRuns).catch(console.error);
  }, [task.id]);

  let spec: Partial<SpecTemplate> | null = null;
  if (task.spec) {
    try { spec = JSON.parse(task.spec) as Partial<SpecTemplate>; } catch {}
  }

  const isAgentActive = ['planning', 'implementing', 'checks', 'review_spec', 'review_code'].includes(task.status);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[1000]" />
        <Dialog.Content className="fixed top-[10vh] left-1/2 -translate-x-1/2 bg-bg-elevated rounded-xl p-6 w-[90%] max-w-[720px] max-h-[80vh] overflow-y-auto z-[1001] shadow-2xl border border-border-default">
          {/* Header */}
          <div className="flex justify-between items-start mb-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-white">{task.title}</Dialog.Title>
              <div className="flex items-center gap-2 mt-1 text-xs">
                <span className={statusBadgeColor[task.status] || 'text-text-tertiary'}>{task.status.replace(/_/g, ' ')}</span>
                <span className="text-text-tertiary">·</span>
                <span className={riskTextColor[task.riskLevel] || 'text-text-tertiary'}>{task.riskLevel} risk</span>
                <span className="text-text-tertiary">·</span>
                <span className="text-text-tertiary">P{task.priority}</span>
              </div>
              <Link to={`/tasks/${task.id}`} onClick={onClose} className="text-xs text-accent-blue hover:underline mt-1 inline-block">
                View Details →
              </Link>
            </div>
            <Dialog.Close className="text-text-tertiary hover:text-text-primary text-2xl leading-none">×</Dialog.Close>
          </div>

          {/* Description */}
          {task.description && (
            <div className="mb-4 pb-4 border-b border-border-default">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-1.5">Description</h4>
              <p className="text-sm text-text-primary whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {/* Spec */}
          {spec && (
            <div className="mb-4 pb-4 border-b border-border-default">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-1.5">Spec</h4>
              {Object.entries(spec).map(([key, val]) =>
                val ? (
                  <div key={key} className="mb-2">
                    <div className="text-[11px] font-semibold text-text-tertiary capitalize">{key.replace(/([A-Z])/g, ' $1')}</div>
                    <p className="text-sm text-text-primary whitespace-pre-wrap mt-0.5">{val}</p>
                  </div>
                ) : null
              )}
            </div>
          )}

          {/* Status-specific panels */}
          {task.status === 'blocked' && task.blockedReason && (
            <BlockedPanel taskId={task.id} blockedReason={task.blockedReason} onAnswer={onAnswer} />
          )}
          {task.status === 'needs_human_review' && <PRPanel task={task} onMove={onMove} />}
          {task.status === 'failed' && (
            <div className="mb-4">
              <button onClick={() => onRetry(task.id)} className="px-4 py-2 rounded-md text-sm font-semibold bg-accent-red text-white hover:bg-red-600 transition-colors">
                Retry Task
              </button>
            </div>
          )}

          {/* Live logs */}
          {isAgentActive && (
            <div className="mb-4 pb-4 border-b border-border-default">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-1.5">Live Logs</h4>
              <LogViewer taskId={task.id} />
            </div>
          )}

          {/* Run history */}
          <div className="mb-4 pb-4 border-b border-border-default">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-1.5">Runs ({runs.length})</h4>
            <RunHistory runs={runs} />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <button onClick={() => onEdit(task)} className="px-4 py-2 rounded-md text-sm font-semibold bg-accent-blue text-white hover:bg-blue-600 transition-colors">Edit</button>
            <button
              onClick={async () => { if (confirm('Delete this task?')) { await onDelete(task.id); onClose(); } }}
              className="px-4 py-2 rounded-md text-sm font-semibold bg-accent-red text-white hover:bg-red-600 transition-colors"
            >Delete</button>
            <Link to={`/tasks/${task.id}`} onClick={onClose} className="ml-auto text-sm text-accent-blue hover:underline">
              View Details →
            </Link>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ui && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/TaskDetail.tsx
git commit -m "feat(ui): convert TaskDetail to Radix Dialog + Tailwind dark theme"
```

---

### Task 10: Convert TaskForm to Radix Dialog + Tailwind

**Files:**
- Modify: `ui/src/components/TaskForm.tsx`

- [ ] **Step 1: Rewrite `ui/src/components/TaskForm.tsx`**

Replace entire file. Key changes:
- Wrap in Radix Dialog
- All inline styles → Tailwind classes
- Dark theme inputs: `bg-bg-tertiary border-border-default focus:ring-accent-blue`
- Keep two-phase flow (describe → preview)

```tsx
import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from '../api/client';
import type { Task, RiskLevel, SpecTemplate } from '../types';

interface Props {
  initial?: Task | null;
  onSubmit: (data: { title: string; description: string; spec: string; riskLevel: RiskLevel; priority: number }) => Promise<void>;
  onCancel: () => void;
}

function parseSpec(spec: string | null): SpecTemplate {
  const empty: SpecTemplate = { context: '', acceptanceCriteria: '', constraints: '', verification: '', riskLevel: 'low', infrastructureAllowed: '' };
  if (!spec) return empty;
  try { return { ...empty, ...(JSON.parse(spec) as Partial<SpecTemplate>) }; } catch { return empty; }
}

type Phase = 'describe' | 'preview';

const inputClasses = 'w-full rounded-md bg-bg-tertiary border border-border-default px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-blue focus:border-transparent resize-y';
const btnClasses = 'px-4 py-2 rounded-md text-sm font-semibold transition-colors duration-150 cursor-pointer';

export const TaskForm: React.FC<Props> = ({ initial, onSubmit, onCancel }) => {
  const isEditing = !!initial;
  const [phase, setPhase] = useState<Phase>(isEditing ? 'preview' : 'describe');
  const [shortDescription, setShortDescription] = useState('');
  const [parsing, setParsing] = useState(false);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [riskLevel, setRiskLevel] = useState<RiskLevel>(initial?.riskLevel ?? 'low');
  const [priority, setPriority] = useState(initial?.priority ?? 0);
  const [spec, setSpec] = useState<SpecTemplate>(() => parseSpec(initial?.spec ?? null));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleParse = async () => {
    if (!shortDescription.trim()) { setError('Please describe the task'); return; }
    setError(''); setParsing(true);
    try {
      const parsed = await api.post<{ title: string; description: string; riskLevel: RiskLevel; priority: number; spec: { context: string; acceptanceCriteria: string; constraints: string; verification: string; infrastructureAllowed: string } }>('/api/tasks/parse', { description: shortDescription.trim() });
      setTitle(parsed.title || ''); setDescription(parsed.description || '');
      setRiskLevel(parsed.riskLevel || 'low'); setPriority(parsed.priority || 0);
      if (parsed.spec) setSpec({ context: parsed.spec.context || '', acceptanceCriteria: parsed.spec.acceptanceCriteria || '', constraints: parsed.spec.constraints || '', verification: parsed.spec.verification || '', riskLevel: parsed.riskLevel || 'low', infrastructureAllowed: parsed.spec.infrastructureAllowed || '' });
      setPhase('preview');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to parse task'); } finally { setParsing(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (!title.trim()) { setError('Title is required'); return; }
    setSubmitting(true);
    try { await onSubmit({ title: title.trim(), description: description.trim(), spec: JSON.stringify({ ...spec, riskLevel }), riskLevel, priority }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSubmitting(false); }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[1000]" />
        <Dialog.Content className="fixed top-[10vh] left-1/2 -translate-x-1/2 bg-bg-elevated rounded-xl p-6 w-[90%] max-w-[600px] max-h-[80vh] overflow-y-auto z-[1001] shadow-2xl border border-border-default">
          {phase === 'describe' && (
            <>
              <Dialog.Title className="text-lg font-semibold text-white mb-1">New Task</Dialog.Title>
              <p className="text-xs text-text-secondary mb-3">Describe what you need done. Fields will be auto-filled.</p>
              {error && <div className="text-accent-red text-sm mb-3">{error}</div>}
              <textarea
                value={shortDescription} onChange={(e) => setShortDescription(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleParse(); } }}
                className={`${inputClasses} min-h-[80px]`}
                placeholder='e.g. "Add rate limiting to the /api/upload endpoint, max 10 req/min per user"'
                autoFocus disabled={parsing}
              />
              <div className="flex gap-2 mt-4">
                <button onClick={handleParse} disabled={parsing} className={`${btnClasses} bg-accent-blue text-white ${parsing ? 'opacity-60' : 'hover:bg-blue-600'}`}>
                  {parsing ? 'Parsing...' : 'Auto-fill'}
                </button>
                <button onClick={() => setPhase('preview')} className={`${btnClasses} text-text-secondary border border-border-default hover:bg-bg-tertiary`}>Fill manually</button>
                <button onClick={onCancel} className={`${btnClasses} bg-text-tertiary text-white hover:bg-gray-600`}>Cancel</button>
              </div>
            </>
          )}

          {phase === 'preview' && (
            <form onSubmit={handleSubmit}>
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title className="text-lg font-semibold text-white">{isEditing ? 'Edit Task' : 'Review & Create'}</Dialog.Title>
                {!isEditing && <button type="button" onClick={() => setPhase('describe')} className="text-xs text-accent-blue hover:underline">← Back</button>}
              </div>
              {error && <div className="text-accent-red text-sm mb-3">{error}</div>}

              <label className="block text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClasses} placeholder="Task title" />

              <label className="block text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-1 mt-3">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputClasses} min-h-[60px]`} placeholder="Brief description" />

              <div className="flex gap-3 mt-3">
                <div className="flex-1">
                  <label className="block text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">Risk Level</label>
                  <select value={riskLevel} onChange={(e) => setRiskLevel(e.target.value as RiskLevel)} className={inputClasses}>
                    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">Priority</label>
                  <input type="number" value={priority} onChange={(e) => setPriority(parseInt(e.target.value) || 0)} className={inputClasses} min={0} />
                </div>
              </div>

              <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mt-5 mb-2">Spec Template</h3>
              {(['context', 'acceptanceCriteria', 'constraints', 'verification', 'infrastructureAllowed'] as const).map((field) => (
                <div key={field} className="mb-3">
                  <label className="block text-[11px] font-semibold text-text-tertiary capitalize mb-1">{field.replace(/([A-Z])/g, ' $1')}</label>
                  <textarea value={spec[field]} onChange={(e) => setSpec({ ...spec, [field]: e.target.value })} className={`${inputClasses} min-h-[60px]`} />
                </div>
              ))}

              <div className="flex gap-2 mt-4">
                <button type="submit" disabled={submitting} className={`${btnClasses} bg-accent-blue text-white ${submitting ? 'opacity-60' : 'hover:bg-blue-600'}`}>
                  {submitting ? 'Saving...' : isEditing ? 'Update' : 'Create'}
                </button>
                <button type="button" onClick={onCancel} className={`${btnClasses} bg-text-tertiary text-white hover:bg-gray-600`}>Cancel</button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ui && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/TaskForm.tsx
git commit -m "feat(ui): convert TaskForm to Radix Dialog + Tailwind dark theme"
```

---

### Task 11: Convert BlockedPanel and PRPanel to Tailwind

**Files:**
- Modify: `ui/src/components/BlockedPanel.tsx`
- Modify: `ui/src/components/PRPanel.tsx`

- [ ] **Step 1: Rewrite `ui/src/components/BlockedPanel.tsx`**

```tsx
import React, { useState } from 'react';

interface Props {
  taskId: string;
  blockedReason: string;
  onAnswer: (id: string, answers: string) => Promise<unknown>;
}

export const BlockedPanel: React.FC<Props> = ({ taskId, blockedReason, onAnswer }) => {
  const [answerText, setAnswerText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!answerText.trim()) return;
    setSubmitting(true);
    try { await onAnswer(taskId, answerText); setAnswerText(''); }
    catch (err) { console.error('Failed to submit answer:', err); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="mb-4 p-4 rounded-lg border-t-2 border-t-accent-amber bg-bg-tertiary border border-border-default">
      <h4 className="text-xs font-bold uppercase tracking-wider text-accent-amber mb-2">Blocked</h4>
      <p className="text-sm text-text-primary whitespace-pre-wrap mb-3">{blockedReason}</p>
      <textarea
        value={answerText} onChange={(e) => setAnswerText(e.target.value)}
        placeholder="Provide your answer..."
        rows={4}
        className="w-full rounded-md bg-bg-secondary border border-border-default px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-amber resize-y mb-2"
      />
      <button onClick={handleSubmit} disabled={submitting || !answerText.trim()}
        className="px-4 py-2 rounded-md text-sm font-semibold bg-accent-amber text-white hover:bg-amber-600 transition-colors disabled:opacity-50">
        {submitting ? 'Submitting...' : 'Submit Answer'}
      </button>
    </div>
  );
};
```

- [ ] **Step 2: Rewrite `ui/src/components/PRPanel.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Task, TaskStatus } from '../types';

interface EventRecord { id: string; taskId: string; type: string; payload: string; createdAt: string }

interface Props {
  task: Task;
  onMove: (id: string, column: TaskStatus) => Promise<unknown>;
}

export const PRPanel: React.FC<Props> = ({ task, onMove }) => {
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    api.get<EventRecord[]>(`/api/events?taskId=${task.id}`).then((events) => {
      const prEvent = events.find((e) => e.type === 'pr_created');
      if (prEvent) {
        try { const payload = JSON.parse(prEvent.payload) as { prUrl?: string }; if (payload.prUrl) setPrUrl(payload.prUrl); } catch {}
      }
    }).catch(console.error);
  }, [task.id]);

  const handleMarkDone = async () => {
    setMarking(true);
    try { await onMove(task.id, 'done'); } catch (err) { console.error('Failed to mark as done:', err); } finally { setMarking(false); }
  };

  return (
    <div className="mb-4 p-4 rounded-lg border-t-2 border-t-accent-green bg-bg-tertiary border border-border-default">
      <h4 className="text-xs font-bold uppercase tracking-wider text-accent-green mb-2">Pull Request</h4>
      {prUrl ? (
        <div className="mb-3">
          <a href={prUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-accent-blue hover:underline">
            {prUrl}
          </a>
        </div>
      ) : (
        <p className="text-sm text-text-secondary mb-3">PR URL not available. Check the run history.</p>
      )}
      <button onClick={handleMarkDone} disabled={marking}
        className="px-4 py-2 rounded-md text-sm font-semibold bg-accent-green text-white hover:bg-green-600 transition-colors disabled:opacity-50">
        {marking ? 'Marking...' : 'Mark as Done'}
      </button>
    </div>
  );
};
```

- [ ] **Step 3: Verify they compile**

```bash
cd ui && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/BlockedPanel.tsx ui/src/components/PRPanel.tsx
git commit -m "feat(ui): convert BlockedPanel and PRPanel to Tailwind dark theme"
```

---

## Chunk 4: Remaining Component Conversions

### Task 12: Convert LogViewer to Tailwind

**Files:**
- Modify: `ui/src/components/LogViewer.tsx`

- [ ] **Step 1: Rewrite `ui/src/components/LogViewer.tsx`**

Replace inline styles with Tailwind. Add Clear button and Auto-scroll toggle. Keep the dark terminal theme (it already matches).

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { useSocket } from '../hooks/useSocket';

interface LogEntry { taskId: string; runId: string; chunk: string; timestamp: string }
interface Props { taskId: string }

export const LogViewer: React.FC<Props> = ({ taskId }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const socket = useSocket();

  useEffect(() => {
    if (!socket) return;
    const onLog = (entry: LogEntry) => {
      if (entry.taskId === taskId) setLogs((prev) => [...prev, entry]);
    };
    socket.on('run:log', onLog);
    return () => { socket.off('run:log', onLog); };
  }, [socket, taskId]);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, autoScroll]);

  const copyAll = () => {
    const text = logs.map((e) => `${new Date(e.timestamp).toLocaleTimeString()} ${e.chunk}`).join('');
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  if (logs.length === 0) {
    return <div className="text-sm text-text-secondary p-2">No logs yet. Logs will appear here in real-time as the agent works.</div>;
  }

  return (
    <div className="relative">
      <div className="absolute top-2 right-2 z-10 flex gap-1.5">
        <button onClick={() => setAutoScroll(!autoScroll)}
          className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${autoScroll ? 'bg-accent-blue/20 border-accent-blue text-accent-blue' : 'bg-bg-elevated border-border-default text-text-tertiary'}`}>
          {autoScroll ? 'Auto ↓' : 'Manual'}
        </button>
        <button onClick={() => setLogs([])} className="px-2 py-0.5 rounded text-[11px] bg-bg-elevated border border-border-default text-text-tertiary hover:text-text-primary">
          Clear
        </button>
        <button onClick={copyAll} className="px-2 py-0.5 rounded text-[11px] bg-bg-elevated border border-border-default text-text-tertiary hover:text-text-primary">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="bg-bg-secondary text-text-primary font-mono text-xs leading-relaxed p-3 rounded-lg max-h-[300px] overflow-y-auto">
        {logs.map((entry, i) => (
          <div key={i} className="flex gap-2 whitespace-pre-wrap break-all">
            <span className="text-text-tertiary flex-shrink-0">{new Date(entry.timestamp).toLocaleTimeString()}</span>
            <span className="flex-1">{entry.chunk}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ui && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/LogViewer.tsx
git commit -m "feat(ui): convert LogViewer to Tailwind, add Clear and Auto-scroll toggle"
```

---

### Task 13: Convert EventsTimeline to Tailwind Dark Theme

**Files:**
- Modify: `ui/src/components/EventsTimeline.tsx`

- [ ] **Step 1: Rewrite `ui/src/components/EventsTimeline.tsx`**

Replace all inline styles with Tailwind. Dark theme colors. Keep all existing logic (event summarization, expandable payloads, WebSocket live updates).

```tsx
import React, { useState, useEffect } from 'react';
import { useSocket } from '../hooks/useSocket';

interface EventRecord { id: string; taskId: string; runId: string | null; type: string; payload: string; createdAt: string }
interface Props { taskId: string; events: EventRecord[] }

const EVENT_COLORS: Record<string, string> = {
  status_changed: 'text-accent-blue', implementation_failed: 'text-accent-red',
  checks_failed: 'text-accent-red', review_spec_failed: 'text-accent-red',
  review_code_failed: 'text-accent-red', pr_created: 'text-accent-green',
  task_created: 'text-text-tertiary', subtasks_created: 'text-text-tertiary',
  task_error: 'text-accent-red', answer_provided: 'text-accent-purple',
};

function getEventColor(type: string, payload: Record<string, unknown>): string {
  if (type === 'status_changed' && payload.to === 'blocked') return 'text-accent-amber';
  return EVENT_COLORS[type] ?? 'text-text-tertiary';
}

function summarizeEvent(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case 'status_changed': return `Status changed: ${payload.from} → ${payload.to}${payload.reason ? ` (${payload.reason})` : ''}`;
    case 'implementation_failed': return `Implementation failed (attempt ${payload.attempt})`;
    case 'checks_failed': return `Checks failed (attempt ${payload.attempt})`;
    case 'review_spec_failed': return `Spec review failed (cycle ${payload.reviewCycle})`;
    case 'review_code_failed': return `Code review failed (cycle ${payload.reviewCycle})`;
    case 'pr_created': return `PR #${payload.prNumber} created`;
    case 'pr_creation_failed': return `PR creation failed: ${payload.error}`;
    case 'task_created': return 'Task created';
    case 'subtasks_created': return `${payload.count} subtasks created`;
    case 'task_error': return `Error: ${(payload.error as string)?.slice(0, 100)}`;
    case 'answer_provided': return 'Human provided answers';
    default: return type.replace(/_/g, ' ');
  }
}

export const EventsTimeline: React.FC<Props> = ({ taskId, events: initialEvents }) => {
  const [events, setEvents] = useState<EventRecord[]>(initialEvents);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const socket = useSocket();

  useEffect(() => { setEvents(initialEvents); }, [initialEvents]);

  useEffect(() => {
    if (!socket) return;
    const onEvent = (event: EventRecord) => {
      if (event.taskId === taskId) setEvents((prev) => prev.some((e) => e.id === event.id) ? prev : [...prev, event]);
    };
    socket.on('task:event', onEvent);
    return () => { socket.off('task:event', onEvent); };
  }, [socket, taskId]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  if (events.length === 0) return <div className="text-text-secondary text-center py-5">No events yet</div>;

  return (
    <div className="relative pl-7">
      <div className="absolute left-2 top-1 bottom-1 w-0.5 bg-border-default" />
      {events.map((event) => {
        const payload = (() => { try { return JSON.parse(event.payload); } catch { return {}; } })();
        const colorClass = getEventColor(event.type, payload);
        const isExpanded = expanded.has(event.id);
        return (
          <div key={event.id} className="relative mb-4 cursor-pointer" onClick={() => toggleExpand(event.id)}>
            <div className={`absolute -left-6 top-0.5 text-sm leading-none ${colorClass}`}>●</div>
            <div className="flex gap-3 items-baseline">
              <span className="text-[11px] text-text-tertiary whitespace-nowrap min-w-[70px]">{new Date(event.createdAt).toLocaleTimeString()}</span>
              <span className="text-[13px] text-text-primary">{summarizeEvent(event.type, payload)}</span>
            </div>
            {isExpanded && (
              <pre className="mt-2 p-3 bg-bg-secondary rounded-md text-xs text-text-primary font-mono overflow-auto max-h-[300px] whitespace-pre-wrap break-words border border-border-default">
                {JSON.stringify(payload, null, 2)}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
};
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ui && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/EventsTimeline.tsx
git commit -m "feat(ui): convert EventsTimeline to Tailwind dark theme"
```

---

### Task 14: Convert RunHistory to Tailwind Dark Theme

**Files:**
- Modify: `ui/src/components/RunHistory.tsx`

- [ ] **Step 1: Rewrite `ui/src/components/RunHistory.tsx`**

```tsx
import React, { useState } from 'react';
import type { Run } from '../types';

interface Props { runs: Run[] }

const statusColor: Record<string, string> = {
  running: 'text-accent-blue', success: 'text-accent-green', failed: 'text-accent-red', cancelled: 'text-text-tertiary',
};

export const RunHistory: React.FC<Props> = ({ runs }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (runs.length === 0) return <div className="text-sm text-text-secondary p-1">No runs yet.</div>;

  return (
    <div className="space-y-1.5">
      {runs.map((run) => {
        const isExpanded = expandedId === run.id;
        const duration = run.finishedAt && run.startedAt
          ? Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
          : null;
        return (
          <div key={run.id} className="bg-bg-secondary rounded-md overflow-hidden border border-border-default">
            <div className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-bg-tertiary transition-colors" onClick={() => setExpandedId(isExpanded ? null : run.id)}>
              <div className="flex items-center gap-2 flex-wrap text-[13px]">
                <span className="font-semibold text-text-primary">{run.stage}</span>
                <span className={`font-semibold ${statusColor[run.status] || 'text-text-tertiary'}`}>{run.status}</span>
                <span className="text-text-tertiary text-xs">attempt #{run.attempt}</span>
                {run.modelUsed && <span className="text-text-tertiary text-xs">{run.modelUsed}</span>}
                {run.tokensUsed != null && <span className="text-text-tertiary text-xs">{run.tokensUsed.toLocaleString()} tokens</span>}
                {duration != null && <span className="text-text-tertiary text-xs">{duration}s</span>}
              </div>
              <div className="text-[11px] text-text-tertiary">
                {new Date(run.startedAt).toLocaleString()} {isExpanded ? '[-]' : '[+]'}
              </div>
            </div>
            {isExpanded && run.output && (
              <div className="bg-bg-primary font-mono text-xs text-text-primary p-3 max-h-[200px] overflow-y-auto border-t border-border-default">
                <pre className="whitespace-pre-wrap break-all m-0">{run.output}</pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ui && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/RunHistory.tsx
git commit -m "feat(ui): convert RunHistory to Tailwind dark theme"
```

---

### Task 15: Convert Settings to Routed Page + Tailwind

**Files:**
- Modify: `ui/src/components/Settings.tsx`

- [ ] **Step 1: Rewrite `ui/src/components/Settings.tsx`**

Key changes: Remove `onClose` prop. Remove overlay/modal wrapper. Make it a standard page component. Two-column layout with section nav on left. Tailwind dark theme.

```tsx
import React, { useState, useEffect } from 'react';
import { api } from '../api/client';

interface Commands { test: string | null; lint: string | null; format: string | null; formatFix: string | null; typecheck: string | null; security: string | null }
interface Notifications { desktop: boolean; terminal: boolean }
interface ModelDefaults { planning: string; implementation: string; reviewSpec: string; reviewCode: string; security: string }
interface Config {
  port: number; host: string; maxConcurrentTasks: number; maxAttemptsPerTask: number; maxReviewCycles: number; maxSubcardDepth: number;
  prDraft: boolean; autoMerge: boolean; prMethod: string; securityMode: string; branchPrefix: string; baseBranch: string; githubRemote: string;
  commitPolicy: string; formatPolicy: string; commands: Commands; notifications: Notifications; modelDefaults: ModelDefaults;
}

type Section = 'commands' | 'security' | 'budgets' | 'branch' | 'policies' | 'models' | 'notifications';
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'commands', label: 'Commands' }, { key: 'security', label: 'Security' }, { key: 'budgets', label: 'Budgets' },
  { key: 'branch', label: 'Branch & PR' }, { key: 'policies', label: 'Policies' }, { key: 'models', label: 'Models' },
  { key: 'notifications', label: 'Notifications' },
];

const inputClasses = 'w-full rounded-md bg-bg-tertiary border border-border-default px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-blue';

export const Settings: React.FC = () => {
  const [config, setConfig] = useState<Config | null>(null);
  const [activeSection, setActiveSection] = useState<Section>('commands');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api.get<Config>('/api/config').then(setConfig).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load config'));
  }, []);

  const save = async () => {
    if (!config) return;
    setSaving(true); setError(''); setSuccess('');
    try { const updated = await api.put<Config>('/api/config', config); setConfig(updated); setSuccess('Settings saved.'); setTimeout(() => setSuccess(''), 2000); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSaving(false); }
  };

  if (!config) {
    return <div className="flex items-center justify-center h-64">{error ? <span className="text-accent-red">{error}</span> : <span className="text-text-secondary">Loading settings...</span>}</div>;
  }

  const setCmd = (key: keyof Commands, value: string) => setConfig({ ...config, commands: { ...config.commands, [key]: value || null } });

  return (
    <div className="flex h-full">
      {/* Section nav */}
      <nav className="w-48 flex-shrink-0 border-r border-border-default p-4">
        {SECTIONS.map(({ key, label }) => (
          <button key={key} onClick={() => setActiveSection(key)}
            className={`block w-full text-left px-3 py-1.5 rounded-md text-[13px] mb-0.5 transition-colors ${activeSection === key ? 'bg-bg-elevated text-white font-medium' : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'}`}>
            {label}
          </button>
        ))}
      </nav>

      {/* Form content */}
      <div className="flex-1 p-6 overflow-y-auto">
        {activeSection === 'commands' && (
          <FormSection title="Check Commands">
            {(['test', 'lint', 'format', 'formatFix', 'typecheck', 'security'] as const).map((key) => (
              <Field key={key} label={key}><input type="text" value={config.commands[key] ?? ''} onChange={(e) => setCmd(key, e.target.value)} placeholder={`${key} command (leave empty to disable)`} className={inputClasses} /></Field>
            ))}
          </FormSection>
        )}
        {activeSection === 'security' && (
          <FormSection title="Security">
            <Field label="Security Mode">
              <select value={config.securityMode} onChange={(e) => setConfig({ ...config, securityMode: e.target.value })} className={inputClasses}>
                <option value="lightweight">lightweight</option><option value="strict">strict</option><option value="off">off</option>
              </select>
            </Field>
          </FormSection>
        )}
        {activeSection === 'budgets' && (
          <FormSection title="Budgets">
            {([['maxConcurrentTasks', 1, 10], ['maxAttemptsPerTask', 1, 50], ['maxReviewCycles', 1, 20], ['maxSubcardDepth', 0, 10]] as const).map(([key, min, max]) => (
              <Field key={key} label={key}><input type="number" min={min} max={max} value={config[key]} onChange={(e) => setConfig({ ...config, [key]: parseInt(e.target.value, 10) || min })} className={inputClasses} /></Field>
            ))}
          </FormSection>
        )}
        {activeSection === 'branch' && (
          <FormSection title="Branch & PR">
            {(['branchPrefix', 'baseBranch', 'githubRemote', 'prMethod'] as const).map((key) => (
              <Field key={key} label={key}><input type="text" value={config[key]} onChange={(e) => setConfig({ ...config, [key]: e.target.value })} className={inputClasses} /></Field>
            ))}
            <Field label="PR Draft"><label className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" checked={config.prDraft} onChange={(e) => setConfig({ ...config, prDraft: e.target.checked })} className="accent-accent-blue" /> Create PRs as drafts</label></Field>
            <Field label="Auto Merge"><label className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" checked={config.autoMerge} onChange={(e) => setConfig({ ...config, autoMerge: e.target.checked })} className="accent-accent-blue" /> Auto-merge PRs when checks pass</label></Field>
          </FormSection>
        )}
        {activeSection === 'policies' && (
          <FormSection title="Policies">
            <Field label="Commit Policy"><select value={config.commitPolicy} onChange={(e) => setConfig({ ...config, commitPolicy: e.target.value })} className={inputClasses}><option value="after-checks-pass">after-checks-pass</option></select></Field>
            <Field label="Format Policy"><select value={config.formatPolicy} onChange={(e) => setConfig({ ...config, formatPolicy: e.target.value })} className={inputClasses}><option value="auto-fix-separate-commit">auto-fix-separate-commit</option></select></Field>
          </FormSection>
        )}
        {activeSection === 'models' && (
          <FormSection title="Model Defaults">
            {(['planning', 'implementation', 'reviewSpec', 'reviewCode', 'security'] as const).map((key) => (
              <Field key={key} label={key}><input type="text" value={config.modelDefaults[key]} onChange={(e) => setConfig({ ...config, modelDefaults: { ...config.modelDefaults, [key]: e.target.value } })} placeholder={`Model for ${key}`} className={inputClasses} /></Field>
            ))}
          </FormSection>
        )}
        {activeSection === 'notifications' && (
          <FormSection title="Notifications">
            <Field label="Desktop"><label className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" checked={config.notifications.desktop} onChange={(e) => setConfig({ ...config, notifications: { ...config.notifications, desktop: e.target.checked } })} className="accent-accent-blue" /> Desktop notifications</label></Field>
            <Field label="Terminal"><label className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" checked={config.notifications.terminal} onChange={(e) => setConfig({ ...config, notifications: { ...config.notifications, terminal: e.target.checked } })} className="accent-accent-blue" /> Terminal notifications</label></Field>
          </FormSection>
        )}

        {/* Save bar */}
        <div className="sticky bottom-0 bg-bg-primary border-t border-border-default py-3 mt-6 flex items-center gap-3">
          <button onClick={save} disabled={saving} className="px-5 py-2 rounded-md text-sm font-semibold bg-accent-blue text-white hover:bg-blue-600 transition-colors disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {error && <span className="text-accent-red text-sm">{error}</span>}
          {success && <span className="text-accent-green text-sm">{success}</span>}
        </div>
      </div>
    </div>
  );
};

const FormSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mb-6">
    <h3 className="text-xs font-bold uppercase tracking-wider text-text-tertiary mb-3">{title}</h3>
    <div className="space-y-3">{children}</div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center gap-3">
    <label className="w-40 flex-shrink-0 text-[13px] font-semibold text-text-secondary">{label}</label>
    <div className="flex-1">{children}</div>
  </div>
);
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ui && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/Settings.tsx
git commit -m "feat(ui): convert Settings from modal to routed page, Tailwind dark theme"
```

---

### Task 16: Convert TaskPage to Tailwind Dark Theme

**Files:**
- Modify: `ui/src/components/TaskPage.tsx`

- [ ] **Step 1: Rewrite `ui/src/components/TaskPage.tsx`**

Replace all inline styles with Tailwind. Dark theme. Keep three-tab structure.

```tsx
import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { LogViewer } from './LogViewer';
import { RunHistory } from './RunHistory';
import { EventsTimeline } from './EventsTimeline';
import type { Task, Run, TaskStatus } from '../types';

type Tab = 'logs' | 'events' | 'runs';
const ACTIVE_STATUSES: TaskStatus[] = ['planning', 'implementing', 'checks', 'review_spec', 'review_code'];

function getInitialTab(): Tab {
  const hash = window.location.hash.slice(1);
  if (hash === 'logs' || hash === 'events' || hash === 'runs') return hash;
  return 'logs';
}

const statusBadgeColor: Record<string, string> = {
  backlog: 'bg-text-tertiary', ready: 'bg-accent-blue', planning: 'bg-accent-purple',
  implementing: 'bg-accent-purple', checks: 'bg-accent-purple', review_spec: 'bg-accent-purple',
  review_code: 'bg-accent-purple', needs_human_review: 'bg-accent-pink', done: 'bg-accent-green',
  blocked: 'bg-accent-amber', failed: 'bg-accent-red', cancelled: 'bg-text-tertiary',
};

const riskBorderColor: Record<string, string> = {
  high: 'border-accent-red text-accent-red', medium: 'border-accent-amber text-accent-amber', low: 'border-accent-green text-accent-green',
};

interface EventRecord { id: string; taskId: string; runId: string | null; type: string; payload: string; createdAt: string }

export const TaskPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [tab, setTab] = useState<Tab>(getInitialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([api.get<Task>(`/api/tasks/${id}`), api.get<Run[]>(`/api/runs?taskId=${id}`), api.get<EventRecord[]>(`/api/events?taskId=${id}`)])
      .then(([t, r, e]) => { setTask(t); setRuns(r); setEvents(e); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load task'))
      .finally(() => setLoading(false));
  }, [id]);

  const changeTab = (t: Tab) => { setTab(t); window.location.hash = t; };

  if (loading) return <div className="flex items-center justify-center h-64 text-text-secondary">Loading...</div>;
  if (error || !task) return (
    <div className="flex flex-col items-center justify-center h-64">
      <div className="text-accent-red mb-2">{error || 'Task not found'}</div>
      <Link to="/" className="text-accent-blue hover:underline">← Back to Board</Link>
    </div>
  );

  const isActive = ACTIVE_STATUSES.includes(task.status);
  const tabs: { key: Tab; label: string }[] = [{ key: 'logs', label: 'Live Logs' }, { key: 'events', label: 'Events Timeline' }, { key: 'runs', label: 'Run History' }];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-border-default flex-shrink-0">
        <Link to="/" className="text-text-secondary hover:text-text-primary text-sm">← Board</Link>
        <h1 className="text-base font-semibold text-white flex-1 truncate">{task.title}</h1>
        <span className={`${statusBadgeColor[task.status] || 'bg-text-tertiary'} text-white px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase`}>
          {task.status.replace(/_/g, ' ')}
        </span>
        <span className={`border ${riskBorderColor[task.riskLevel] || 'border-text-tertiary text-text-tertiary'} px-2 py-0.5 rounded-full text-[11px] font-semibold`}>
          {task.riskLevel} risk
        </span>
        <span className="text-xs text-text-tertiary">P{task.priority}</span>
        <div className="flex gap-2">
          {task.status === 'failed' && (
            <button onClick={async () => { await api.post(`/api/tasks/${task.id}/retry`); const t = await api.get<Task>(`/api/tasks/${task.id}`); setTask(t); }}
              className="px-3 py-1 rounded-md text-xs font-semibold bg-accent-amber text-white hover:bg-amber-600 transition-colors">Retry</button>
          )}
          <button onClick={async () => { if (confirm('Delete this task?')) { await api.del(`/api/tasks/${task.id}`); window.location.href = '/'; } }}
            className="px-3 py-1 rounded-md text-xs font-semibold bg-accent-red text-white hover:bg-red-600 transition-colors">Delete</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border-default pl-5 flex-shrink-0">
        {tabs.map(({ key, label }) => (
          <button key={key} onClick={() => changeTab(key)}
            className={`px-5 py-2.5 text-sm border-b-2 transition-colors ${tab === key ? 'border-accent-blue text-accent-blue font-semibold' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
            {label}
            {key === 'logs' && isActive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent-green ml-1.5 animate-pulse-dot" />}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-5">
        {tab === 'logs' && (isActive ? <LogViewer taskId={task.id} /> : <div className="text-text-secondary text-center pt-10">No active execution. Task status: {task.status.replace(/_/g, ' ')}</div>)}
        {tab === 'events' && <EventsTimeline taskId={task.id} events={events} />}
        {tab === 'runs' && <RunHistory runs={runs} />}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ui && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/TaskPage.tsx
git commit -m "feat(ui): convert TaskPage to Tailwind dark theme"
```

---

## Chunk 5: Activity Feed Backend + Frontend, Final Verification

### Task 17: Add Backend Endpoint for Project Events

**Files:**
- Modify: `src/db/queries.ts`
- Modify: `src/server/routes/events.ts`

- [ ] **Step 1: Add `listEventsByProject` query to `src/db/queries.ts`**

Add this function after the existing `listEventsByTask` function at line 576:

```typescript
export function listEventsByProject(
  db: Database.Database,
  projectId: string,
  limit: number = 50,
  cursor?: string
): (Event & { taskTitle: string })[] {
  const cursorClause = cursor ? 'AND e.id < ?' : '';
  const params: unknown[] = [projectId];
  if (cursor) params.push(cursor);
  params.push(limit);

  const rows = db
    .prepare(
      `SELECT e.*, t.title as task_title FROM events e
       JOIN tasks t ON e.task_id = t.id
       WHERE t.project_id = ? ${cursorClause}
       ORDER BY e.id DESC
       LIMIT ?`
    )
    .all(...params) as (Record<string, unknown>)[];

  return rows.map((row) => ({
    ...rowToEvent(row),
    taskTitle: row.task_title as string,
  }));
}
```

- [ ] **Step 2: Add `projectId` query support to `src/server/routes/events.ts`**

Replace the route handler:

```typescript
import { Router } from 'express';
import type Database from 'better-sqlite3';
import * as queries from '../../db/queries.js';

export function createEventRoutes(db: Database.Database): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const { taskId, projectId, limit, cursor } = req.query as {
      taskId?: string;
      projectId?: string;
      limit?: string;
      cursor?: string;
    };

    if (projectId) {
      const events = queries.listEventsByProject(
        db,
        projectId,
        limit ? parseInt(limit, 10) : 50,
        cursor || undefined
      );
      res.json(events);
      return;
    }

    if (!taskId) {
      res.status(400).json({ error: 'taskId or projectId query param is required' });
      return;
    }

    const events = queries.listEventsByTask(db, taskId);
    res.json(events);
  });

  return router;
}
```

- [ ] **Step 3: Verify the server compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/db/queries.ts src/server/routes/events.ts
git commit -m "feat(api): add listEventsByProject endpoint with cursor pagination"
```

---

### Task 18: Create ActivityFeed Component

**Files:**
- Create: `ui/src/components/ActivityFeed.tsx`

- [ ] **Step 1: Create `ui/src/components/ActivityFeed.tsx`**

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket';
import { api } from '../api/client';
import type { Task } from '../types';

interface FeedEvent {
  id: string;
  taskId: string;
  runId: string | null;
  type: string;
  payload: string;
  createdAt: string;
  taskTitle: string;
}

interface Props {
  projectId: string;
  tasks: Task[];
}

const EVENT_COLORS: Record<string, string> = {
  status_changed: 'text-accent-blue', implementation_failed: 'text-accent-red',
  checks_failed: 'text-accent-red', review_spec_failed: 'text-accent-red',
  review_code_failed: 'text-accent-red', pr_created: 'text-accent-green',
  task_created: 'text-text-tertiary', subtasks_created: 'text-text-tertiary',
  task_error: 'text-accent-red', answer_provided: 'text-accent-purple',
};

function summarizeEvent(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case 'status_changed': return `moved to ${payload.to}${payload.reason ? ` (${payload.reason})` : ''}`;
    case 'implementation_failed': return `implementation failed (attempt ${payload.attempt})`;
    case 'checks_failed': return `checks failed (attempt ${payload.attempt})`;
    case 'review_spec_failed': return `spec review failed (cycle ${payload.reviewCycle})`;
    case 'review_code_failed': return `code review failed (cycle ${payload.reviewCycle})`;
    case 'pr_created': return `PR #${payload.prNumber} created`;
    case 'task_created': return 'created';
    case 'subtasks_created': return `${payload.count} subtasks created`;
    case 'task_error': return `error: ${(payload.error as string)?.slice(0, 80)}`;
    case 'answer_provided': return 'human answered';
    default: return type.replace(/_/g, ' ');
  }
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export const ActivityFeed: React.FC<Props> = ({ projectId, tasks }) => {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const socket = useSocket();

  const taskIds = new Set(tasks.map((t) => t.id));

  const loadEvents = useCallback(async (cursor?: string) => {
    try {
      const params = new URLSearchParams({ projectId, limit: '50' });
      if (cursor) params.set('cursor', cursor);
      const fetched = await api.get<FeedEvent[]>(`/api/events?${params}`);
      if (cursor) {
        setEvents((prev) => [...prev, ...fetched]);
      } else {
        setEvents(fetched);
      }
      setHasMore(fetched.length === 50);
    } catch (err) {
      console.error('Failed to load events:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { setLoading(true); loadEvents(); }, [loadEvents]);

  // Live updates
  useEffect(() => {
    if (!socket) return;
    const onEvent = (event: FeedEvent) => {
      if (taskIds.has(event.taskId)) {
        const taskTitle = tasks.find((t) => t.id === event.taskId)?.title || 'Unknown';
        setEvents((prev) => prev.some((e) => e.id === event.id) ? prev : [{ ...event, taskTitle }, ...prev]);
      }
    };
    socket.on('task:event', onEvent);
    return () => { socket.off('task:event', onEvent); };
  }, [socket, tasks]);

  if (loading) return <div className="flex items-center justify-center h-64 text-text-secondary">Loading activity...</div>;

  if (events.length === 0) return <div className="flex items-center justify-center h-64 text-text-secondary">No activity yet</div>;

  const lastEvent = events[events.length - 1];

  return (
    <div className="p-5 max-w-3xl mx-auto">
      <div className="space-y-1">
        {events.map((event) => {
          const payload = (() => { try { return JSON.parse(event.payload); } catch { return {}; } })();
          const colorClass = (event.type === 'status_changed' && payload.to === 'blocked')
            ? 'text-accent-amber'
            : EVENT_COLORS[event.type] ?? 'text-text-tertiary';
          return (
            <div key={event.id} className="flex items-start gap-3 py-2 px-3 rounded-md hover:bg-bg-tertiary transition-colors group">
              <span className={`mt-1 text-xs ${colorClass}`}>●</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <Link to={`/tasks/${event.taskId}`} className="text-sm font-medium text-text-primary hover:text-accent-blue truncate max-w-[300px]">
                    {event.taskTitle}
                  </Link>
                  <span className="text-[13px] text-text-secondary">{summarizeEvent(event.type, payload)}</span>
                </div>
              </div>
              <span className="text-[11px] text-text-tertiary whitespace-nowrap flex-shrink-0">{timeAgo(event.createdAt)}</span>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <div className="text-center mt-4">
          <button onClick={() => loadEvents(lastEvent?.id)} className="px-4 py-2 text-sm text-text-secondary border border-border-default rounded-md hover:bg-bg-tertiary transition-colors">
            Load more
          </button>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ui && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/ActivityFeed.tsx
git commit -m "feat(ui): add ActivityFeed page with cursor pagination and live updates"
```

---

### Task 19: Full Build Verification and Cleanup

**Files:** All

- [ ] **Step 1: Run full TypeScript check**

```bash
cd ui && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Run full Vite build**

```bash
cd ui && npx vite build
```

Expected: Build succeeds, outputs to `dist/`.

- [ ] **Step 3: Run server TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Verify `styles.css` is deleted and `app.css` is imported**

```bash
ls ui/src/styles.css 2>/dev/null && echo "ERROR: styles.css still exists" || echo "OK: styles.css deleted"
grep "app.css" ui/src/main.tsx && echo "OK: app.css imported" || echo "ERROR: app.css not imported"
```

- [ ] **Step 5: Commit any cleanup**

If any fixes were needed, stage only the specific files that changed:

```bash
git status
# Stage only modified files, e.g.:
# git add ui/src/components/SomeFile.tsx
git commit -m "fix(ui): resolve build issues from UI overhaul migration"
```

- [ ] **Step 6: Final commit with all changes verified**

```bash
git log --oneline -15
```

Review that all commits are present and logical.
