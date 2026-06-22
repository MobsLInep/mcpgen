# Contributing to mcpgen

Thanks for your interest — contributions are very welcome! mcpgen is MIT-licensed
and built to be hacked on. This guide gets you from clone to PR.

## Prerequisites

- **Node 20+** (`.nvmrc` pins the major version; run `nvm use`).
- **pnpm 9+** (`corepack enable` will provide the pinned version).

## Local development

```bash
git clone https://github.com/MobsLInep/mcpgen
cd mcpgen
pnpm install
pnpm build
```

The full local gate — everything required before a PR, and what CI runs on Node
20 and 22 — is:

```bash
pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test
```

Two extra gates also run in CI and are worth running locally:

```bash
pnpm test:coverage   # enforces engine + verify coverage thresholds
pnpm security:lint   # OWASP secure-MCP audit over output + own source (needs a prior build)
```

## Project layout

mcpgen is a pnpm + Turborepo monorepo. The generation logic lives in one pure
library; every front end is thin over it.

| Path                    | Role                                                         |
| ----------------------- | ------------------------------------------------------------ |
| `packages/core`         | Generation engine — a **pure library** (no web/server deps). |
| `packages/cli`          | The `mcpgen` command (commander). Stays thin.                |
| `packages/templates`    | Templates for the generated MCP server.                      |
| `apps/web` · `apps/api` | Web UI + the `node:http` backend it calls.                   |
| `apps/docs`             | Documentation site (Nextra 4).                               |

The one rule to internalize: **keep `packages/core` pure.** If you reach for
`next`, `http`, or server-heavy `fs` inside `core`, it belongs in `cli`/`api`.
See [`CLAUDE.md`](./CLAUDE.md) for the full, phase-by-phase architecture record —
read it before adding code so the stack stays consistent.

## Conventions

- **TypeScript strict** everywhere — no `any` without a justified
  `// eslint-disable`.
- **Conventional Commits** for messages (`feat:`, `fix:`, `chore:`, `docs:`,
  `test:`).
- Tests are self-contained and import from `src` (not `dist`) so `pnpm test`
  works without a prior build.
- Run `pnpm format` (Prettier) before committing.

## Filing issues & PRs

- Use the **issue templates** (bug report / feature request) when opening an
  issue.
- New here? Look for the
  [`good first issue`](https://github.com/MobsLInep/mcpgen/labels/good%20first%20issue)
  label — those are scoped and well-described.
- Open PRs against `main` and fill in the **PR template**. All of `build`,
  `typecheck`, `lint`, and `test` must pass.

## Code of Conduct

This project adheres to the [Contributor Covenant](./CODE_OF_CONDUCT.md). By
participating, you agree to uphold it. Be kind.
