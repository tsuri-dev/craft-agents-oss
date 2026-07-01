# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

- **Zed session binding** — Added a `/bind` helper for Craft ACP threads in Zed: `/bind` lists the 10 most recent non-hidden Craft sessions and `/bind <number>` attaches the current Zed thread to one of them so future messages continue that Craft conversation.

## Bug Fixes

## Breaking Changes

- **External messaging channels removed** — Telegram, WhatsApp, Lark / Feishu, and WeChat/iLink integrations have been removed from the desktop app, server runtime, IPC/RPC APIs, and bundled packages. Startup now performs best-effort cleanup of old messaging credentials/state and macOS OpenClaw remnants.
