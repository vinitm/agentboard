# Subtask Visibility, Failure Reasons & Copy Buttons

**Date:** 2026-03-13

## Problem

1. Subtasks of failed tasks are not visible — only tiny dot indicators in TaskCard
2. No way to see failure reasons without digging into Events/Runs tabs
3. No copy button on Run History output or Events Timeline payloads; non-active tasks show no logs at all

## Design

### Principle: A subtask is just a task

Subtasks use the same TaskPage, same data model, same UI patterns. The only difference is they have a `parentTaskId`.

### 1. SubtaskMiniCard component

New reusable component `SubtaskMiniCard.tsx`:
- Small rounded container with left border colored by status (reuses `leftBorderClass` pattern from TaskCard)
- Shows: status dot + title (truncated) + failure indicator (red icon when failed)
- Clicking navigates to `/tasks/:subtaskId` via react-router

Used in both TaskCard (board view) and TaskPage (detail view).

### 2. TaskCard subtask rendering update

Replace the current dot-list subtask items with `SubtaskMiniCard` components:
- Keep the existing expand/collapse toggle and progress bar
- Each expanded subtask renders as a SubtaskMiniCard instead of a dot+text line
- Click navigates to the subtask's TaskPage (not the modal)

### 3. Board navigation change

`Board.tsx` changes `onSubtaskClick` from opening TaskDetail modal to navigating via react-router to `/tasks/:subtaskId`.

### 4. TaskPage enhancements

- **Breadcrumb:** If viewing a subtask, show `← Board / Parent Task Title / Subtask Title` with links
- **Subtask list:** If the task has subtasks, display them below the header using SubtaskMiniCard
- **Historical output for non-active tasks:** Instead of "No active execution", show the most recent run's output as static read-only content with a copy button. Falls back to "No logs available" if empty.

### 5. CopyButton component

New reusable component `CopyButton.tsx`:
- Extracted from LogViewer's existing copy pattern
- Props: `text: string` (content to copy), optional `className`
- Small button, `text-[11px]`, shows "Copied!" for 2s
- Uses `navigator.clipboard.writeText()`

### 6. Copy buttons added to

- **RunHistory:** Top-right of each expanded run output panel
- **EventsTimeline:** Top-right of each expanded event payload
- **LogViewer:** Refactored to use CopyButton
- **TaskPage non-active state:** Historical output area

## Files Changed

| File | Change |
|------|--------|
| New: `ui/src/components/CopyButton.tsx` | Reusable copy-to-clipboard component |
| New: `ui/src/components/SubtaskMiniCard.tsx` | Mini-card for subtasks |
| `ui/src/components/TaskCard.tsx` | Replace dot-list with SubtaskMiniCard, navigate on click |
| `ui/src/components/TaskPage.tsx` | Breadcrumb, subtask list, historical output |
| `ui/src/components/RunHistory.tsx` | Add CopyButton to expanded output |
| `ui/src/components/EventsTimeline.tsx` | Add CopyButton to expanded payloads |
| `ui/src/components/LogViewer.tsx` | Refactor to use CopyButton |
| `ui/src/components/Board.tsx` | Navigate on subtask click instead of modal |

## No Backend Changes

All data already available via existing APIs (`/api/tasks/:id`, `/api/runs?taskId=`, `/api/events?taskId=`).
