# Session Board MVP Plan

## Goal

Add a board view for Craft Agent sessions, grouped by session workflow status, using Multica's board interaction model as the reference.

This is the first local extension we are adding to Craft Agent. The implementation must be useful, but it must also stay easy to sync with the fork source default branch.

## Current Craft Agent Fit

Craft Agent already has most of the required domain pieces:

1. Sessions have workflow status metadata.
2. Workspace statuses are configurable in `statuses/config.json`.
3. Statuses are loaded through `listStatuses(workspaceRootPath)`.
4. There are existing state-filter routes like `state/{stateId}`.
5. Session search/filter logic already understands `sessionStatus`.
6. Session status can already be changed from UI menus and session tools.

The missing piece is a multi-column board view that shows multiple statuses at once and supports drag-and-drop movement.

## Accepted MVP Scope

1. Add a board/list view toggle for sessions.
2. Render one column per workspace status, sorted by status `order`.
3. Group sessions by `session.sessionStatus || defaultStatusId || "todo"`.
4. Render session cards using existing session metadata: title, preview, unread state, labels, flag, last activity.
5. Drag a session to another status column to update its `sessionStatus`.
6. Drag within the same column to persist manual order.
7. Store board view preference and hidden columns as local UI preference.
8. Keep current list view as the default unless we explicitly decide otherwise.
9. Keep existing state route behavior unchanged.

## Non-Goals For MVP

1. Do not add a server-backed pagination system.
2. Do not replace the existing session list.
3. Do not hardcode Multica statuses.
4. Do not redesign the full app shell.
5. Do not change archive semantics in this pass.
6. Do not implement custom status CRUD UI; it already exists through status config editing.

## Data Model

Existing session metadata:

```ts
sessionStatus?: string
isArchived?: boolean
isFlagged?: boolean
labels?: unknown[]
lastUsedAt?: number
```

Required addition:

```ts
boardPosition?: number
```

Rationale:

1. Cross-column movement needs `sessionStatus`.
2. Same-column manual ordering needs a persistent position independent of `lastUsedAt`.
3. A floating numeric position avoids rewriting every session on each move.

Position algorithm:

1. If moved to top: `next.boardPosition - 1`.
2. If moved to bottom: `prev.boardPosition + 1`.
3. If moved between two cards: average previous and next positions.
4. If neighbors have no position, fall back to their rendered index or `lastUsedAt` derived order for the first migration.

## UI Model

Board layout:

1. Horizontal scroll area.
2. Fixed-width columns.
3. Column header: status icon, label, count, menu.
4. Column body: sortable session cards.
5. Empty column state.
6. Optional hidden-column panel.

Session card:

1. Session title.
2. Preview or last user message snippet.
3. Status/label visual metadata only when useful.
4. Unread and flagged indicators.
5. Click opens the existing session route.
6. Context menu should reuse existing session actions where practical.

Drag behavior:

1. Use `@dnd-kit/core` and `@dnd-kit/sortable`, matching Multica's proven pattern.
2. Keep local `columns` state during drag.
3. Freeze the session map during drag.
4. On drag over, update local columns for visual feedback.
5. On drag end, persist `sessionStatus` and `boardPosition`.
6. On failure, restore prior metadata and show an error.

## Implementation Phases

### V0: Documentation And Shape

Status: complete.

Deliverables:

1. `plan/wiki.md`
2. `plan/session-board-mvp.md`

### V1: Read-Only Board

Status: complete.

Goal: show sessions grouped by status without changing data.

Tasks:

1. Add `SessionBoard` component in a new file.
2. Add `SessionBoardColumn` component in a new file.
3. Add `SessionBoardCard` component in a new file.
4. Generate columns from loaded workspace statuses.
5. Group filtered visible sessions by `sessionStatus`.
6. Add a board/list toggle preference.

Verification:

1. Existing list still works.
2. Board shows all configured statuses.
3. Sessions with missing status fall back to default status.
4. Archived behavior matches current filter semantics.

### V2: Cross-Column Status Drag

Status: complete.

Goal: moving a session across columns updates `sessionStatus`.

Tasks:

1. Add dnd-kit to board components if already available, or add dependency carefully.
2. Implement temporary local columns state.
3. Reuse existing session status update path.
4. Broadcast/consume existing session metadata changed events.
5. Keep state-filter routes compatible.

Verification:

1. Drag from Todo to Done updates metadata.
2. Session appears in new column immediately.
3. Existing list and state route reflect the new status.
4. Failed persistence rolls back.

### V3: Same-Column Manual Ordering

Status: complete.

Goal: allow sessions to be reordered within the same status.

Tasks:

1. Add `boardPosition?: number` to session metadata types.
2. Persist `boardPosition` in session metadata.
3. Sort board columns by `boardPosition`, then `lastUsedAt`.
4. Compute floating positions on drag end.

Verification:

1. Same-column reorder survives app restart.
2. Moving across columns preserves a sensible position in the target column.
3. Existing non-board sorting/search behavior is unchanged.

### V4: Board Preferences

Status: complete.

Goal: make the board comfortable for regular use.

Tasks:

1. Persist board/list view preference.
2. Persist hidden status columns per workspace.
3. Add hidden column restore UI.
4. Optionally add compact/comfortable card density.

Verification:

1. Preferences survive restart.
2. Preferences are workspace-scoped.
3. Hidden statuses do not lose sessions; they are only hidden from board display.

### V5: Board Workflow And Recent View

Status: complete.

Goal: keep the board as the primary workflow surface and make Views useful as dynamic filters, not duplicated status/label shortcuts.

Tasks:

1. Remove the primary-header action for saving the current filter as a View.
2. Keep optional `displayMode` and `boardGroupBy` fields available for future curated Views.
3. Apply a View's preferred List/Board mode when opening it.
4. Let Board group sessions by status or by first label.
5. Add status quick actions on Board cards.
6. Add a built-in `Recent 7 Days` View using `daysSince(lastUsedAt) <= 7`.
7. Migrate existing `views.json` to add the new time-based View once.

Verification:

1. Saved views continue to use the existing `views.json` storage.
2. Old views without the optional fields still load normally.
3. Board mode works for saved View routes, status routes, label routes, flagged routes, and All Sessions.
4. Label grouping does not create a second session store; it updates session labels through the existing label callback.
5. Status quick actions use the existing status update callback.
6. `Recent 7 Days` uses existing session-list sorting, which is already most recent activity first.

## Upstream Conflict Strategy

1. New files first: board components should live in dedicated files.
2. Small app-shell integration: touch existing shell only to route data into the new board view and add the toggle.
3. Avoid changing existing session list logic except where a shared helper is clearly extracted.
4. Avoid changing status config schema.
5. Add optional `boardPosition` so old metadata remains valid.
6. Keep tests close to new helpers/components.
7. Before starting implementation, fetch upstream and check whether app shell/session list changed.

## Risks

1. `AppShell.tsx` is large and likely to conflict with upstream.
2. Session metadata persistence may be spread across handlers and renderer state.
3. Archive and closed status semantics may overlap but are not identical.
4. Existing filters/search must continue to apply consistently in board mode.

## Rollback Plan

1. Remove board toggle integration.
2. Keep `boardPosition` ignored if present.
3. Delete new board component files.
4. Existing list view and session metadata remain valid.

## Resolved Decisions

1. Board view should respect the current session filter. If the current filter is `archived`, the board groups archived sessions by status. If the current filter excludes archived sessions, the board must exclude them too. The board is a view over the existing filtered session set, not a new archive policy.
2. Closed statuses should appear by default when they are part of the current filtered set, but users can hide them with board preferences. Do not hardcode `done` or `cancelled` visibility rules in the board.
3. New sessions created from a state route should inherit that status. The existing route builder already accepts a `status` parameter, and board-created sessions should use the same path.
4. Board order is global per workspace and per status, not per filter/view. Filters change which cards are visible, but the underlying `boardPosition` remains attached to the session.

## Definition Of Done

The MVP is complete when all accepted scope items are covered by code, tests, and manual verification:

1. The session area has a Board/List view toggle, and List remains the default.
2. Board columns are generated from workspace statuses sorted by `order`.
3. Sessions are grouped by `sessionStatus`, falling back to the workspace default status and then `"todo"`.
4. Session cards show title, preview, unread state, labels, flag state, and last activity when available.
5. Cross-column drag updates `sessionStatus` and the existing list/state routes reflect the change.
6. Same-column drag persists `boardPosition` and survives restart.
7. Board view preference and hidden columns persist per workspace.
8. Existing session list, search, filters, status menus, and state routes continue to work.
9. The implementation primarily adds new board files and keeps edits to upstream-heavy files small.

## Implementation Entry Points

Start with these files and keep the write set narrow:

1. Add board components:
   - `apps/electron/src/renderer/components/app-shell/SessionBoard.tsx`
   - `apps/electron/src/renderer/components/app-shell/SessionBoardColumn.tsx`
   - `apps/electron/src/renderer/components/app-shell/SessionBoardCard.tsx`
2. Add board helper tests near the new component or in a small helper module:
   - grouping by status
   - fallback status resolution
   - position calculation
3. Add optional metadata type support where session metadata is defined:
   - `packages/core/src/types/session.ts`
   - `packages/shared/src/protocol/dto.ts`
   - renderer shared session metadata types if separate
4. Add persistence/update plumbing only where current session metadata updates already happen.
5. Add the smallest possible integration in `AppShell.tsx` or an extracted child component to choose List vs Board.

## Verification Commands

Run the smallest useful checks after implementation:

1. `bun test apps/electron/src/renderer`
2. `bun test packages/shared`
3. `bun test packages/core`
4. If type changes cross packages, run the repo's existing typecheck command from `package.json`.

If one of these commands is not available in the current checkout, record the exact failure and run the closest package-level test that covers the touched code.

## Implementation Status

Status: implemented on the local fork through V5.

Implemented files:

1. Board UI:
   - `apps/electron/src/renderer/components/app-shell/SessionBoard.tsx`
   - `apps/electron/src/renderer/components/app-shell/SessionBoardColumn.tsx`
   - `apps/electron/src/renderer/components/app-shell/SessionBoardCard.tsx`
   - `apps/electron/src/renderer/components/app-shell/session-board-utils.ts`
   - `apps/electron/src/renderer/components/app-shell/session-board-utils.test.ts`
2. App-shell integration:
   - `apps/electron/src/renderer/components/app-shell/SessionList.tsx`
   - `apps/electron/src/renderer/components/app-shell/AppShell.tsx`
   - `apps/electron/src/renderer/context/AppShellContext.tsx`
   - `apps/electron/src/renderer/App.tsx`
3. Metadata and persistence plumbing:
   - `packages/core/src/types/session.ts`
   - `packages/shared/src/protocol/dto.ts`
   - `packages/shared/src/sessions/types.ts`
   - `packages/shared/src/sessions/storage.ts`
   - `packages/shared/src/sessions/persistence-queue.ts`
   - `packages/shared/src/sessions/index.ts`
   - `packages/server-core/src/handlers/session-manager-interface.ts`
   - `packages/server-core/src/handlers/rpc/sessions.ts`
   - `packages/server-core/src/sessions/SessionManager.ts`
4. Renderer event/state support:
   - `apps/electron/src/renderer/atoms/sessions.ts`
   - `apps/electron/src/renderer/event-processor/types.ts`
   - `apps/electron/src/renderer/event-processor/handlers/session.ts`
   - `apps/electron/src/renderer/event-processor/processor.ts`
   - `apps/electron/src/renderer/lib/local-storage.ts`
   - `apps/electron/src/renderer/playground/PlaygroundAppShellProvider.tsx`
5. Saved View workflow:
   - `packages/shared/src/views/types.ts`
   - `apps/electron/src/renderer/components/app-shell/AppShell.tsx`
   - `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx`
   - `apps/electron/src/renderer/context/AppShellContext.tsx`

Verified:

1. `bun test apps/electron/src/renderer/components/app-shell/session-board-utils.test.ts`
2. `bun run typecheck:electron`
3. Dev Electron server hot reloaded the changed renderer files without compile errors.
4. After copying skills locally, dev logs show `SKILLS_GET: Loaded 44 skills`.

Manual Electron UI verification is still recommended before shipping, especially drag-and-drop feel, keyboard focus, and narrow sidebar sizing.
