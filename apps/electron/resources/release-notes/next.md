# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

- **Plugins hub and TAPD plugin board** — Added a Codex-style Plugins sidebar entry with a plugin hub, installed plugin children, and TAPD as the first plugin. Opening TAPD shows a header-first cached requirement board that refreshes from the configured MCP source on demand, opens requirements in a dedicated two-column detail page with safe Markdown/HTML rendering for TAPD descriptions and description images, links or unlinks requirements to session groups from a right-side business properties panel, creates seeded sessions from requirement context, and adds a lightweight requirement shortcut to linked sessions.

## Improvements

- **Sidebar navigation cleanup** — Removed the experimental Stories sidebar workflow, moved Plugins ahead of Sources, and made All Sessions reset secondary filters when selected.

## Bug Fixes

## Breaking Changes
