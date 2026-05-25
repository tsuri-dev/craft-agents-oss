# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

- **Delegated agent working-directory clarity** — Agent Profile mentions now record the effective child-session working directory in AgentRun manifests, show it in the parent-session start message, and include explicit delegation context in the child prompt so agents verify repository access from their own session instead of guessing. TAPD requirement Agent follow-ups also sync the latest requirement Context into the reused child session before creating the follow-up AgentRun.

## Bug Fixes

## Breaking Changes
