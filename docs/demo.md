# mcpgen — scripted demo

A copy-paste walkthrough of the `mcpgen` CLI. The command sequence below doubles
as an [asciinema](https://asciinema.org) script: record it with

```bash
asciinema rec mcpgen-demo.cast --command "bash docs/demo.sh"
```

where `docs/demo.sh` is the **Command sequence** section pasted into a file. Each
step lists the command and a trimmed sample of its output so the cast can be
regenerated deterministically (everything below runs offline — no API key, no
network).

---

## 0. Check your environment

```console
$ mcpgen doctor
mcpgen doctor — environment check

✔ Node.js: v22.22.0 (>= 20)
● Anthropic API key: not set — generation falls back to deterministic (offline) mode
  → export ANTHROPIC_API_KEY=sk-ant-... for LLM-powered, higher-fidelity generation
✔ Docker: Docker version 29.6.0, build fb59821

All required checks passed.
```

`mcpgen doctor --json` emits the same report as machine-readable JSON.

## 1. Peek at a source before generating

```console
$ mcpgen inspect ./examples/petstore.yaml
Source:    ./examples/petstore.yaml
Kind:      openapi
Title:     Swagger Petstore
Tools:     5

┌────────────────┬──────────────────────┬────────┬──────────────┬───────┐
│ TOOL           │ OPERATION            │ PARAMS │ AUTH         │ CONF  │
├────────────────┼──────────────────────┼────────┼──────────────┼───────┤
│ listPets       │ GET /pets            │ 1      │ -            │ 1.00  │
│ createPet      │ POST /pets           │ 1      │ apiKey       │ 1.00  │
│ showPetById    │ GET /pets/{petId}    │ 1      │ -            │ 1.00  │
│ updatePet      │ PUT /pets/{petId}    │ 2      │ apiKey       │ 1.00  │
│ deletePet      │ DELETE /pets/{petId} │ 1      │ apiKey       │ 1.00  │
└────────────────┴──────────────────────┴────────┴──────────────┴───────┘
```

## 2. The guided wizard

`mcpgen init` walks you through source → transport → auth → output, then runs
generation with a live spinner and a final summary panel:

```console
$ mcpgen init
┌   mcpgen  guided setup
│
◇  Where is your API source?
│  ./examples/petstore.yaml
│
◇  Which transport should the server use?
│  stdio
│
◇  How should upstream auth be handled?
│  Derive from the source
│
◇  Where should the generated server go?
│  ./petstore-mcp
│
◇  Verify the server actually runs after generating?
│  Yes
│
◇  Summary ───────────────────────────────────────────────────────╮
│                                                                 │
│  server   swagger_petstore-mcp                                  │
│  tools    5                                                     │
│  output   ./petstore-mcp                                        │
│  engine   offline mode — deterministic generation (no LLM)      │
│  ✔ verified — installed, built, booted & smoke-tested (1 pass)  │
│                                                                 │
├─────────────────────────────────────────────────────────────────╯
│
◇  Next steps ───────────────────────────────────────────────────────╮
│                                                                    │
│    $ cd ./petstore-mcp                                             │
│    $ npm install && npm run build                                  │
│    $ MCPGEN_TRANSPORT=stdio node dist/server.js                    │
│                                                                    │
│    → See README.md to connect Claude Desktop, Cursor, or VS Code.  │
│                                                                    │
├────────────────────────────────────────────────────────────────────╯
│
└  Your MCP server is ready. 🎉
```

## 3. Non-interactive generation

The same thing the wizard does, in one line — handy for scripts and CI:

```console
$ mcpgen generate ./examples/petstore.yaml --out ./petstore-mcp --offline --no-verify
╭─ mcpgen · generated ──────────────────────────────────────────╮
│ server   swagger_petstore-mcp                                 │
│ tools    5                                                    │
│ output   ./petstore-mcp                                       │
│ engine   offline mode — deterministic generation (no LLM)     │
│ ● verification skipped                                        │
╰───────────────────────────────────────────────────────────────╯

Next steps:
  $ cd ./petstore-mcp
  $ npm install && npm run build
  $ MCPGEN_TRANSPORT=stdio node dist/server.js

  → See README.md to connect Claude Desktop, Cursor, or VS Code.
```

Add `--json` for a machine-readable summary instead of the panel:

```console
$ mcpgen generate ./examples/petstore.yaml --out ./petstore-mcp --offline --no-verify --json
{
  "serverName": "swagger_petstore-mcp",
  "toolCount": 5,
  "outDir": "/abs/path/petstore-mcp",
  "transport": "stdio",
  "verification": "skipped",
  "files": ["package.json", "src/server.ts", ...]
}
```

## 4. Shell completion

```console
$ mcpgen completion zsh > "${fpath[1]}/_mcpgen"   # zsh
$ mcpgen completion bash >> ~/.bashrc             # bash
$ mcpgen completion fish > ~/.config/fish/completions/mcpgen.fish
```

## 5. Run & connect

```console
$ cd ./petstore-mcp
$ npm install && npm run build
$ MCPGEN_TRANSPORT=stdio node dist/server.js
```

The generated `README.md` includes ready-to-paste config for **Claude Desktop**,
**Cursor**, and **VS Code** — see its "Connect this server to an AI client"
section.

---

## Command sequence

Paste into `docs/demo.sh` to record a cast:

```bash
#!/usr/bin/env bash
set -euo pipefail

mcpgen doctor
mcpgen inspect ./examples/petstore.yaml
# interactive: mcpgen init
mcpgen generate ./examples/petstore.yaml --out ./petstore-mcp --offline --no-verify
mcpgen generate ./examples/petstore.yaml --out ./petstore-mcp --offline --no-verify --json
mcpgen completion bash | head -20

cd ./petstore-mcp
npm install
npm run build
echo "→ open README.md for Claude Desktop / Cursor / VS Code config"
```
