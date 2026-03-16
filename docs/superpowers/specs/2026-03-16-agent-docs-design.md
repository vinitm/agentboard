# Agent Documentation for Agentboard

**Date:** 2026-03-16
**Status:** Approved

## Problem

Agentboard has no CLAUDE.md or AGENTS.md — AI coding agents working on the codebase have no persistent onboarding context about conventions, commands, architecture, or gotchas. This leads to repeated mistakes and slower ramp-up each session.

## Decision

Create `AGENTS.md` as the canonical vendor-agnostic doc (~80 lines), with `CLAUDE.md` as a symlink. This gives cross-tool compatibility (Claude Code, Cursor, Zed, Windsurf, etc.) with a single source of truth.

## Content Structure

1. **Project summary** — one-liner describing what agentboard does
2. **Commands** — build, dev, CLI commands
3. **Do/Don't** — conventions and guardrails
4. **Architecture** — 3-layer overview, pipeline flow, key directories
5. **Gotchas** — non-obvious traps (`.js` extensions, singleton DB, worktree sharing, etc.)

## Alternatives Considered

- **CLAUDE.md only**: Limits to Claude Code; other tools won't pick it up.
- **Separate files per tool**: Duplication and drift risk.
- **Symlink approach (chosen)**: Single source of truth, both filenames recognized.
