# CLI Channel Workflow

## Branch layout

- `main` — clean mirror of `upstream/main`. Never commit here.
- `cli-channel` — your patches on top of `main`. All commits live here.

## Daily use

```bash
# 🌟 Interactive REPL bound to a session (recommended)
craft-cli chat                  # picks session interactively
craft-cli chat <session-id>     # bind directly
#   inside REPL:
#     hello world                 -> sends a message, streams the reply
#     /attach src/foo.ts          -> queues a file for the next message
#     /files                      -> shows queued attachments
#     /switch <id|number>         -> switch sessions without exiting
#     /new my-task                -> create + switch
#     /sessions                   -> list recent sessions
#     /history 20                 -> show last 20 messages
#     /cancel                     -> cancel in-progress processing
#     /exit                       -> quit (or Ctrl-D)
#   Ctrl-C while streaming -> cancel current turn, stay in REPL

# One-shot send
craft-cli send <session-id> "explain these" -f src/foo.ts -f src/bar.ts

# Pipe stdin
echo "summarize" | craft-cli send <session-id> -f some-file.md

# List sessions
craft-cli sessions
```

Connection env vars (set in `~/.zshrc`):

```
export CRAFT_SERVER_URL=ws://127.0.0.1:9100
export CRAFT_SERVER_TOKEN=<from Settings → Server>
```

Wrapper script at `~/bin/craft-cli` runs `bun run apps/cli/src/index.ts`.

## Upgrading when upstream releases a new version

```bash
cd ~/Documents/personal-github/craft-agents-oss

# 1. Pull upstream main
git fetch upstream
git checkout main
git merge --ff-only upstream/main
git push origin main

# 2. Rebase patch branch on top
git checkout cli-channel
git rebase main
# If conflicts: fix in apps/cli/src/index.ts, then `git rebase --continue`

# 3. Push your patch branch
git push origin cli-channel --force-with-lease

# 4. Update Craft Agents desktop app via its own auto-updater
#    (we don't fork the electron app — official build keeps working)
#    After update, re-check Settings → Server, token may rotate.
```

## If desktop app rotates the token

After app update or config reset, the `serverConfig.token` in
`~/.craft-agent/config.json` may change. Update both:

1. `~/.zshrc` `CRAFT_SERVER_TOKEN=...`
2. Any scripts that hardcode the token

Read current token without opening the UI:

```bash
grep -A3 serverConfig ~/.craft-agent/config.json | grep token
```

## What's actually patched

Two commits on `cli-channel`, both in `apps/cli/src/index.ts`:

1. **`--file/-f` for `send`** — reads each path via
   `@craft-agent/shared/utils/files.readFileAttachment` and forwards the
   resulting `FileAttachment[]` as the third arg to `sessions:sendMessage`.

2. **`chat` / `repl` interactive REPL** — readline loop bound to one session,
   slash commands for switching/attaching/listing, persistent history at
   `~/.craft-cli-history`.

Rebase risk: very low. Only conflicts if upstream changes:

- `parseArgs` switch statement in `apps/cli/src/index.ts`
- `cmdSend` function signature
- `sendAndStream` function signature
- `sessions:sendMessage` RPC signature

## What we explicitly did NOT do

- ❌ Fork or patch the Electron app (`apps/electron/**`)
- ❌ Touch `packages/messaging-gateway`
- ❌ Build a custom `craftchat` binary
- ❌ Disable auto-update on the desktop app

The desktop app stays 100% stock. All custom logic lives in `apps/cli`,
which is a workspace package consumed via a thin bash wrapper.
