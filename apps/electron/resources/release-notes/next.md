# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

- **Agent Profiles UI shell** — Added an initial Agents sidebar destination with static profile rows and a profile detail preview for future reusable agent presets. This is UI-only for now and lays out the planned instruction, skills, sources, defaults, activity, and artifact-handoff surfaces before execution and persistence are wired. The Activity tab now renders from an AgentRun data skeleton with active runs, 30-day summary metrics, and the latest 10 finished runs; the Instructions tab now reads and writes workspace-backed `instructions.md` files for each profile; the Environment tab can edit profile-level runtime variables for future child agent/MCP launches; and the Agents page can now create profiles, attach workspace skills, import dropped `SKILL.md` files, or enable workspace sources on the current profile.
- **Plugins hub and TAPD plugin board** — Added a Codex-style Plugins sidebar entry with a plugin hub, installed plugin children, and TAPD as the first plugin. Opening TAPD shows a link-import requirement board that fetches individual TAPD requirements from pasted links and saves them locally, opens requirements in a dedicated two-column detail page with safe Markdown/HTML rendering for TAPD descriptions and description images, links or unlinks requirements to session groups from a right-side business properties panel, creates seeded sessions from requirement context, and adds a lightweight requirement shortcut to linked sessions.

## Improvements

- **TAPD link-only board** — Simplified the TAPD Requirement Board by removing direct workspace/list refresh and filter controls. The board now only imports full TAPD requirement links, fetches the matched requirement, and saves it to the local cache. Sessions created from saved TAPD requirements no longer enable the TAPD MCP source or prefill the chat input; instead they reference a shared workspace-level TAPD requirement markdown snapshot that all linked sessions can read. TAPD-linked sessions also expose the snapshot path in agent context and filter out stale `tapd-mcp-http` activation from older sessions. Creating a session from TAPD detail now opens a name/agent dialog, applies the selected Agent Profile's runtime settings, pre-fills the new chat input with `@AgentName `, updates the linked session list without a manual refresh, and keeps the visible mode selector aligned with the backend session mode. Each TAPD requirement now also has a shared `info` directory for implementation plans, handoff notes, and artifacts that existing and future linked sessions can read without depending on session creation order; the detail header exposes these files through a session-info-style popover next to the refresh icon, reloads the list when the window regains focus, reports refresh failures inline, and keeps the right-side properties panel focused on TAPD/linkage metadata.
- **GPT session controls** — Added a session-scoped Fast mode switch under the model picker’s thinking controls for GPT-5 Codex/ChatGPT connections, while keeping Extra High mapped to the existing `xhigh` reasoning level.
- **Sidebar navigation cleanup** — Removed the experimental Stories sidebar workflow, moved Plugins ahead of Sources, and made All Sessions reset secondary filters when selected.

## Bug Fixes

- **Working directory VS Code action** — Restored the small “Open in VS Code” button next to the chat input’s Working Directory badge so the selected folder can be opened directly in VS Code again.
- **TAPD plugin theming** — Updated TAPD requirement details to use Craft Agent theme tokens so the plugin follows the app’s dark mode instead of forcing light surfaces.

## Breaking Changes
