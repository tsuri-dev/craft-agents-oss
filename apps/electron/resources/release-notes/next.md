# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

- **Zed session binding** — Added a `/bind` helper for Craft ACP threads in Zed: `/bind` lists the 10 most recent non-hidden Craft sessions and `/bind <number>` attaches the current Zed thread to one of them so future messages continue that Craft conversation.
- **Projects migration** — Migrated legacy `project::...` session labels to the official Projects model. Sessions are now bound through `session.projectId`; old project labels are removed during startup migration and project filtering/grouping uses official Projects.

## Bug Fixes

- **Open working directory restored** — Restored the chat input shortcut for opening the current working directory in VS Code, Cursor, Zed, Finder, Terminal, and other configured apps.

## Breaking Changes

- **External messaging channels removed** — Telegram, WhatsApp, Lark / Feishu, and WeChat/iLink integrations have been removed from the desktop app, server runtime, IPC/RPC APIs, and bundled packages. Startup now performs best-effort cleanup of old messaging credentials/state and macOS OpenClaw remnants.
- **Legacy session board removed** — Removed the fork-only All Sessions board/list extensions and their `boardPosition` protocol. Use official Projects for project-scoped session lists and the official Task Kanban board for board workflows.
- **Inbox view removed** — Removed the dedicated Inbox session route and sidebar entry. Unread state remains available through session NEW badges and workspace unread indicators.
