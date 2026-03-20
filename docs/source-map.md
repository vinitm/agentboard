# Source Map

## Directory Structure

```
src/
├── cli/           # CLI commands (init, up, down, doctor, prune)
├── db/            # Database schema, queries, migrations
│   ├── schema.ts         # DDL + migrations
│   ├── queries.ts        # Prepared statements (tasks, runs, events, git_refs, artifacts)
│   ├── chat-queries.ts   # Chat message queries
│   ├── cost-queries.ts   # Token cost tracking
│   └── stage-log-queries.ts  # Stage log CRUD
├── detect/        # Language detection, command detection for projects
├── server/        # Express + Socket.IO
│   ├── index.ts          # Express app factory
│   ├── ws.ts             # Socket.IO broadcast helpers
│   └── routes/           # REST API endpoints (see docs/api-routes.md)
├── test/          # Test helpers (createTestDb, createTestRepo, createTestApp)
├── types/         # TypeScript interfaces (Task, Run, Artifact, etc.)
└── worker/        # Autonomous pipeline
    ├── loop.ts           # Main worker loop (5s polling)
    ├── executor.ts       # Claude Code subprocess spawner
    ├── stage-runner.ts   # Stage lifecycle (log, broadcast, summarize)
    ├── context-builder.ts # Task packet builder for prompts
    ├── git.ts            # Worktree create/cleanup/commit
    ├── hooks.ts          # Ruflo hook integration
    ├── memory.ts         # Per-project learning memory
    ├── model-selector.ts # Stage→model mapping via config
    ├── inline-fix.ts     # Fix failed checks inline
    ├── auto-merge.ts     # Auto-merge gate evaluation
    ├── log-writer.ts     # Append-only task log files
    ├── recovery.ts       # Stale claim recovery on startup
    ├── notifications.ts  # Desktop/terminal notifications
    └── stages/           # Pipeline stage implementations
        ├── spec-review.ts
        ├── planner.ts
        ├── implementer.ts
        ├── checks.ts
        ├── code-quality.ts
        ├── final-review.ts
        ├── pr-creator.ts
        └── learner.ts

ui/src/
├── App.tsx               # Main app with routing
├── main.tsx              # Entry point
└── components/
    ├── TaskGrid.tsx       # Kanban grid view
    ├── TaskCard.tsx       # Individual task cards
    ├── TaskPage.tsx       # Task detail page
    ├── TaskForm.tsx       # New task creation form
    ├── TopBar.tsx         # Navigation header
    ├── Sidebar.tsx        # Project sidebar
    ├── PipelineBar.tsx    # Stage progress indicator
    ├── StageAccordion.tsx # Expandable stage logs
    ├── StageRow.tsx       # Single stage row
    ├── LogViewer.tsx      # Real-time log streaming
    ├── LogRenderer.tsx    # ANSI log rendering
    ├── EventsTimeline.tsx # Task event timeline
    ├── RunHistory.tsx     # Run history panel
    ├── PlanReviewPanel.tsx # Engineer plan review
    ├── BlockedPanel.tsx   # Blocked task actions
    ├── PRPanel.tsx        # PR details panel
    ├── SpecField.tsx      # Spec editor fields
    ├── ChatPanel (in TaskPage) # Conversational spec building
    ├── Settings.tsx       # Config editor
    ├── CostDashboard.tsx  # Token cost analytics
    ├── Learnings.tsx      # Learning log viewer
    ├── ActivityFeed.tsx   # Recent activity
    └── (shared: Button, Toast, Tooltip, ConfirmDialog, ErrorBoundary, EmptyState, CopyButton, ShortcutsModal)

prompts/                  # Prompt templates (markdown with {variable} interpolation)
├── brainstorming-system.md  # System prompt for spec chat
├── brainstorming.md         # User prompt for spec chat
├── spec-review.md           # Spec validation
├── planner-v2.md            # Implementation planning
├── plan-review.md           # Plan self-review
├── implementer-v2.md        # Code implementation
├── inline-fix.md            # Fix failed checks
├── code-quality.md          # Code quality review
├── final-review.md          # Full changeset review
└── learner.md               # Learning extraction
```

## Key Types

Defined in `src/types/index.ts`:

- **TaskStatus** — `backlog | ready | spec_review | planning | needs_plan_review | implementing | checks | code_quality | final_review | pr_creation | needs_human_review | done | blocked | failed | cancelled`
- **Stage** — `spec_review | planning | implementing | checks | code_quality | final_review | pr_creation`
- **RiskLevel** — `low | medium | high`
- **ImplementerStatus** — `DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`
- **AutoMergeMode** — `off | draft-only | low-risk | all`
- **Task** — id (integer), projectId, title, description, status, riskLevel, priority, spec (JSON), blockedReason, blockedAtStage, chatSessionId
- **Run** — id, taskId, stage, status, attempt, tokensUsed, modelUsed, input, output
- **PlanningResult** — planSummary, confidence (0-1), steps[], assumptions[], fileMap[]

## Pipeline State Machine

```
backlog → ready → spec_review → planning → needs_plan_review → implementing → checks → code_quality → final_review → pr_creation → done
                                                                     │                        │                │
                                                                     ↓                        ↓                ↓
                                                                  blocked                   failed        needs_human_review
```

- Auto-approval: Low-risk tasks with high planner confidence skip `needs_plan_review`
- Inline fix: When `checks` fail, an inline fix is attempted before blocking
- Quality cycles: Up to 2 code_quality → implement fix cycles before failing
- Final review: Up to 2 final_review → implement fix cycles before failing
