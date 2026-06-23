# mcpgen

Generate a working, typed, deployable **Model Context Protocol (MCP) server**
from an **OpenAPI spec**, a **GraphQL schema**, or a **code repository**. The
generated server exposes the source API's operations as MCP tools an AI agent
can call — and ships with a Dockerfile, Compose file, and Fly/Render/Railway
deploy configs.

## Use it without installing

```bash
npx mcpgenx generate ./openapi.yaml --out ./my-server
# or run the guided wizard:
npx mcpgenx init
```

## Install globally

```bash
npm install -g mcpgen
mcpgen --help
```

## Common commands

| Command                                | What it does                                          |
| -------------------------------------- | ----------------------------------------------------- |
| `mcpgen init`                          | Guided wizard: source → transport → auth → output.    |
| `mcpgen generate <source> --out <dir>` | Generate (and verify) an MCP server.                  |
| `mcpgen inspect <source>`              | Print the detected tool candidates.                   |
| `mcpgen doctor`                        | Check your environment (Node, Anthropic key, Docker). |
| `mcpgen completion <bash\|zsh\|fish>`  | Print a shell-completion script.                      |

Set `ANTHROPIC_API_KEY` for LLM-powered generation; without it, mcpgen falls
back to deterministic, IR-only generation. See the
[deployment guide](https://github.com/MobsLInep/mcpgen/blob/main/docs/deployment.md)
for shipping both the generated servers and mcpgen itself.
