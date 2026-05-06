# Craft Agent Local Extension Wiki

## Purpose

This folder tracks local product extensions we want to add on top of the forked Craft Agent repository.

The first agreed extension is a session board: a board view that groups sessions by workflow status and lets users move sessions across statuses. More extensions may follow, but every extension must preserve our ability to keep syncing from the fork source `master`/default branch with minimal conflict.

## Core Agreements

1. Local extensions should be incremental and easy to rebase.
2. Keep changes close to existing Craft Agent architecture instead of introducing a parallel app shell.
3. Prefer additive files and isolated components over broad rewrites of upstream-owned files.
4. When an upstream file must be touched, keep the edit small and clearly bounded.
5. Preserve existing routes, session list behavior, status configuration, and workspace storage semantics.
6. Statuses must remain workspace-configurable through existing `statuses/config.json`; do not replace them with hardcoded Multica statuses.
7. Session metadata remains the source of truth. Board UI can keep temporary drag state, but must not create a second persistent session store.

## Upstream Sync Principle

Maintaining compatibility with the fork source is a first-class requirement.

Practical rules:

1. Put local planning docs under `plan/`.
2. Put new board UI in new files where possible.
3. Avoid large edits to `AppShell.tsx`; use small integration points or extracted components.
4. Avoid modifying shared protocol names unless required.
5. Prefer new optional metadata fields over changing existing field meaning.
6. Keep feature behavior behind existing view state or a small local preference instead of changing default session semantics globally.
7. Before merging local feature work, compare against upstream default branch and resolve conflicts while they are small.

## Extension Roadmap

### Extension 1: Session Board

Status: implemented locally through V2 workflow enhancements.

Goal: copy the useful part of Multica's status board into Craft Agent.

Accepted MVP:

1. Add a Board/List view toggle for sessions.
2. Generate board columns from existing workspace statuses.
3. Group sessions by `sessionStatus`.
4. Drag sessions across columns to update `sessionStatus`.
5. Support same-column manual ordering with a persistent ordering field.
6. Keep existing session list and state-filter routes working.
7. Keep implementation local and low-conflict with upstream.

Detailed plan: [session-board-mvp.md](session-board-mvp.md)

Current V2 additions:

1. Keep Board/List switching as the primary workflow control.
2. Allow Board grouping by status or label.
3. Add session-card status quick actions in Board mode.
4. Add a built-in `Recent 7 Days` View for time-based filtering.
5. Keep custom View saving out of the primary header until we need real combined filters.

## Multica Reference Summary

Multica implements its board with:

1. Status-configured columns.
2. Per-status grouping.
3. Drag and drop with `@dnd-kit`.
4. Local temporary column state during drag.
5. Optimistic update of server/cache state.
6. Persisted view preferences for filters, sort, card fields, hidden columns.
7. Real-time cache patching when another client changes an issue.

Craft Agent should copy the interaction model, not the exact data model. Multica boards issues; Craft Agent boards sessions. Craft Agent statuses are already configurable per workspace and should remain that way.

## Version Plan Template

Each future extension should add a dedicated file under `plan/` with:

1. Problem statement.
2. Accepted scope.
3. Non-goals.
4. Upstream conflict strategy.
5. Data model changes.
6. UI changes.
7. Implementation phases.
8. Verification checklist.
9. Risks and rollback plan.
