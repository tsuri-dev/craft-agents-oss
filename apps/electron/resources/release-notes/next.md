# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

- **Plugins hub and TAPD plugin board** — Added a Codex-style Plugins sidebar entry with a plugin hub, installed plugin children, and TAPD as the first plugin. Opening TAPD shows a header-first cached requirement board that refreshes from the configured MCP source on demand, opens requirements in a dedicated two-column detail page with safe Markdown/HTML rendering for TAPD descriptions and description images, links or unlinks requirements to session groups from a right-side business properties panel, creates seeded sessions from requirement context, and adds a lightweight requirement shortcut to linked sessions.

## Improvements

- **TAPD link import** — Added an inline Requirement Board entry point for pasting a TAPD story link or story ID, fetching the requirement, and incrementally caching the item without replacing the current board.
- **GPT session controls** — Added a session-scoped Fast mode switch under the model picker’s thinking controls for GPT-5 Codex/ChatGPT connections, while keeping Extra High mapped to the existing `xhigh` reasoning level.
- **TAPD board link add** — Added an “Add by link” flow to the TAPD requirement board so individual TAPD story links can be pulled into the local board cache without a full refresh.
- **Sidebar navigation cleanup** — Removed the experimental Stories sidebar workflow, moved Plugins ahead of Sources, and made All Sessions reset secondary filters when selected.

## Bug Fixes

- **TAPD plugin theming** — Updated TAPD requirement details to use Craft Agent theme tokens so the plugin follows the app’s dark mode instead of forcing light surfaces.

## Breaking Changes
