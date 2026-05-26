# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

- **Delegated agent working-directory clarity** — Agent Profile mentions now record the effective child-session working directory in AgentRun manifests, show it in the parent-session start message, and include explicit delegation context in the child prompt so agents verify repository access from their own session instead of guessing. Reply-to-Agent follow-ups in normal sessions and TAPD requirements also sync the latest parent session / requirement Context into the reused child session before creating the follow-up AgentRun.

## Bug Fixes

- **Agent profile status, activity, and source navigation** — Agent pages now derive visible status from real AgentRun activity (Running/Ready/Draft), share the same run data between list and detail views, and the Sources tab uses in-app source navigation instead of a deeplink path that could crash the page.

## Breaking Changes
