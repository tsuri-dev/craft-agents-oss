# Craft CLI ACP Server

`craft-cli acp` runs Craft Agent as an [Agent Client Protocol](https://agentclientprotocol.com) stdio server for editors such as Zed.

## Status

This is an MVP intended for the `explore/cli-acp-zed` branch.

Supported:

- `initialize`
- `session/new`
- `session/prompt`
- `session/cancel`
- `session/close`
- `session/set_mode`
- streamed assistant text
- basic tool call updates
- embedded text resources, including Zed selection context

Not supported yet:

- ACP `session/load`, `session/resume`, and `session/list`
- Zed-native permission popups via `session/request_permission`
- image/audio prompt content
- forwarding Zed-provided MCP servers into Craft source runtime

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
      "env": {}
    }
  }
}
```

Notes:

- Use an absolute `command` path. GUI-launched Zed may not inherit your shell `PATH`.
- `--mode safe`, `--mode ask`, and `--mode allow-all` map to Craft permission modes.
- Repeat `--source <slug>` to pre-enable Craft sources in new ACP sessions.
- Add `--server-entry <path>` when running outside the monorepo layout.
- Add `--url ws://... --token ...` to connect to an existing Craft server instead of spawning a local server.

## Selection context

Zed can add selected code to an External Agent thread via:

- `agent: add selection to thread`
- `cmd->` / `ctrl->`
- the `+` menu in the Agent Panel message editor

Zed sends selected text as ACP embedded resources. The adapter converts each text resource into Craft prompt context:

````md
Context resource: /path/to/file.ts
MIME type: text/typescript
```ts
selected code...
```
````

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
