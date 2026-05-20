# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

- **Plugins hub and TAPD plugin board** — Added a Codex-style Plugins sidebar entry with a plugin hub, installed plugin children, and TAPD as the first plugin. Opening TAPD shows a link-import requirement board that fetches individual TAPD requirements from pasted links and saves them locally, opens requirements in a dedicated two-column detail page with safe Markdown/HTML rendering for TAPD descriptions and description images, links or unlinks requirements to session groups from a right-side business properties panel, creates seeded sessions from requirement context, and adds a lightweight requirement shortcut to linked sessions.

## Improvements

- **TAPD link-only board** — Simplified the TAPD Requirement Board by removing direct workspace/list refresh and filter controls. The board now only imports full TAPD requirement links, fetches the matched requirement, and saves it to the local cache.
- **GPT session controls** — Added a session-scoped Fast mode switch under the model picker’s thinking controls for GPT-5 Codex/ChatGPT connections, while keeping Extra High mapped to the existing `xhigh` reasoning level.
- **Sidebar navigation cleanup** — Removed the experimental Stories sidebar workflow, moved Plugins ahead of Sources, and made All Sessions reset secondary filters when selected.

## Bug Fixes

- **TAPD plugin theming** — Updated TAPD requirement details to use Craft Agent theme tokens so the plugin follows the app’s dark mode instead of forcing light surfaces.

## Breaking Changes
