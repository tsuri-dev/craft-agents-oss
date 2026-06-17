# Craft CLI ACP Server

`craft-cli acp` runs Craft Agent as an [Agent Client Protocol](https://agentclientprotocol.com) stdio server for editors such as Zed.

## Status

This is an MVP intended for the `explore/cli-acp-zed` branch.

Supported:

- `initialize`
- `session/new`
- `session/list`
- `session/load`
- `session/resume`
- `session/prompt`
- `session/cancel`
- `session/close`
- `session/set_mode`
- streamed assistant text
- basic tool call updates
- embedded text resources, including Zed selection context
- active Craft workspace routing by default
- automatic `zed` label for new ACP sessions
- automatic attach to a running local Craft server when `.server.json` is present

Not supported yet:

- Zed-native permission popups via `session/request_permission`
- image/audio prompt content
- forwarding Zed-provided MCP servers into Craft source runtime

## Workspace behavior

By default, `craft-cli acp` puts new Zed sessions in the currently active Craft workspace for the configured `CRAFT_CONFIG_DIR`.

Zed's `cwd` is still preserved as the Craft session `workingDirectory`, so tools and file context run against the editor project directory without forcing that directory to become a separate Craft workspace.

Priority order:

1. `--workspace <id>` if provided
2. Active workspace from `${CRAFT_CONFIG_DIR:-~/.craft-agent}/config.json`
3. Existing workspace whose root matches the Zed `cwd`
4. Create a fallback workspace from the Zed `cwd` when needed
5. First available workspace

New ACP sessions are labelled `zed`. `session/list` returns all non-hidden sessions in the active Craft workspace so Zed can import existing Craft conversations, not only sessions originally created from Zed.

## Server attachment

When a local Craft app/server is already running, bootstrap writes `${CRAFT_CONFIG_DIR:-~/.craft-agent}/.server.json` with the local WebSocket URL and token. `craft-cli acp` automatically uses that file before spawning a new headless server.

This lets Zed talk to the same Dev app backend instead of starting a second server and colliding with `.server.lock`.

You can still force a specific server with:

```bash
craft-cli --url ws://127.0.0.1:12345 --token <token> acp
```

## Zed custom agent config

Open Zed settings and add:

```json
{
  "agent_servers": {
    "craft-agent-dev": {
      "type": "custom",
      "command": "/Users/corinli/.bun/bin/bun",
      "args": [
        "/Users/corinli/Documents/personal-github/craft-agents-oss/apps/cli/src/index.ts",
        "acp",
        "--mode",
        "ask"
      ],
      "env": {
        "CRAFT_CONFIG_DIR": "/Users/corinli/.craft-agent-dev"
      }
    }
  }
}
```

Notes:

- Use an absolute `command` path. GUI-launched Zed may not inherit your shell `PATH`.
- `--mode safe`, `--mode ask`, and `--mode allow-all` map to Craft permission modes.
- Repeat `--source <slug>` to pre-enable Craft sources in new ACP sessions.
- Add `--workspace <id>` to force a Craft workspace instead of using the active workspace.
- Add `--workspace-dir <path>` as a fallback directory when no active workspace exists.
- Add `--server-entry <path>` when running outside the monorepo layout.
- Add `--url ws://... --token ...` to connect to a specific Craft server.

## History / continue previous sessions

Zed can discover previous Craft sessions through `session/list`, then continue them with either:

- `session/load` — replays the conversation history into Zed first, then returns a `LoadSessionResponse` object
- `session/resume` — reconnects without replaying history

Zed's Thread History import flow calls `session/list`. The adapter returns all non-hidden sessions in the active Craft workspace, sorted by recent activity. Each imported entry includes a `cwd`: the session working directory when present, otherwise the Craft workspace root.

New sessions created from Zed are still labelled `zed`, but the label is not required for import.

The loaded/resumed Craft session keeps using the Zed-provided `cwd` as its working directory.

## Craft sources and skills from Zed

Zed's External Agent UI does not expose Craft's source/skill picker. Use the adapter's helper commands or Craft bracket mentions directly in the prompt:

```text
/craft
/sources
/skills
/use-source tapd-openapi-docs 查一下 comment add API
/use-skill brainstorming 帮我拆一下方案
[source:tapd-openapi-docs] 查一下 comment add API
[skill:brainstorming] 帮我拆一下方案
```

The adapter advertises these as ACP slash commands via `available_commands_update`, so Zed accepts them in the External Agent input box. `/craft` opens the current ACP-backed Craft session in a focused Craft Agent window. `/sources` and `/skills` are handled locally by the ACP adapter and do not call the model. `/use-source` and `/use-skill` are rewritten to bracket mentions before sending the prompt to Craft.

Supported mention forms:

- `[source:<slug>]`
- `[skill:<slug>]`
- `[file:<path>]`
- `[folder:<path>]`
- `[agent:<id>]`

Repeat `--source <slug>` in the Zed custom agent config to pre-enable sources for every new ACP session. Bracket mentions or `/use-source` are still useful for explicit per-message context. `/use-skill` passes the selected skill as `skillSlugs` and preserves the bracket mention so Craft can inject the skill instructions.

## Selection context

Zed can add selected code to an External Agent thread via:

- `agent: add selection to thread`
- `cmd->` / `ctrl->`
- the `+` menu in the Agent Panel message editor

Zed sends selected text as ACP embedded resources. The adapter converts each text resource into Craft prompt context and preserves Zed selection/symbol URI metadata when present:

````md
Context resource: /path/to/file.ts
Range: L42-L60
Symbol: renderCard
MIME type: text/typescript
```ts
selected code...
```
````

Recognized Zed URI forms include `file:///path/to/file.ts#L42:60`, `file:///path/to/file.ts?symbol=renderCard#L42-L60`, and `zed:///agent/selection?path=/path/to/file.ts#L42-L60`.

## Smoke test

```bash
cd apps/cli
python3 - <<'PY'
import json, subprocess
proc = subprocess.Popen(
    ["bun", "src/index.ts", "acp"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
)
try:
    req = {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"smoke"}}}
    proc.stdin.write(json.dumps(req, separators=(",", ":")) + "\n")
    proc.stdin.flush()
    print(proc.stdout.readline().strip())
finally:
    proc.terminate()
PY
```

## Debugging in Zed

Use the Command Palette:

- `dev: open acp logs`
- `agent: open settings`

`craft-cli acp` must never write non-JSON data to stdout. Logs go to stderr and are prefixed with `[craft-cli acp]`.
