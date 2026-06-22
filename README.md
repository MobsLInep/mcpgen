# mcpgen

![Status: under construction](https://img.shields.io/badge/status-under%20construction-orange)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

**mcpgen** takes an OpenAPI spec, a GraphQL schema, or a code repository and
generates a working, typed, deployable [Model Context Protocol](https://modelcontextprotocol.io)
(MCP) server — so you can turn any existing API surface into tools an AI agent
can call, without hand-writing the glue.

> **Status: under construction.** This repository is at **Phase 0 (scaffolding only)**.
> The generation engine is not implemented yet. See [`CLAUDE.md`](./CLAUDE.md) for
> the architecture, locked stack decisions, and the phase plan.

## Monorepo layout

| Path                 | Description                                         |
| -------------------- | --------------------------------------------------- |
| `packages/core`      | Generation engine — pure, dependency-light library. |
| `packages/cli`       | The `mcpgen` command-line interface.                |
| `packages/templates` | MCP server code templates the engine renders.       |
| `apps/web`           | Next.js 15 web UI (placeholder).                    |
| `apps/api`           | Thin backend the web UI calls (placeholder).        |

## Getting started

Requires **Node 20+** and **pnpm 9+**.

```bash
pnpm install
pnpm build       # build all packages via Turborepo
pnpm typecheck   # tsc --noEmit across the workspace
pnpm lint        # ESLint (flat config)
pnpm test        # Vitest
```

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Licensed under [MIT](./LICENSE).
