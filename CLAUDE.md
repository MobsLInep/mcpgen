# CLAUDE.md — mcpgen

This file orients future Claude Code (and human) sessions. Read it before making
changes so the architecture and stack stay consistent across phases.

## What mcpgen is

Given one of three inputs — an **OpenAPI spec**, a **GraphQL schema**, or a
**code repository** — mcpgen generates a working, typed, deployable **Model
Context Protocol (MCP) server**. The generated server exposes the source API's
operations as MCP tools an AI agent can call.

## Architecture

```
                 ┌──────────────┐
  OpenAPI /      │ packages/cli │  mcpgen <command>   (commander)
  GraphQL /  ──► │   (thin)     │
  repo           └──────┬───────┘
                        │ calls
                 ┌──────▼────────────┐      renders   ┌────────────────────┐
                 │  packages/core    │ ─────────────► │ packages/templates │
                 │ generation engine │                │  MCP server code   │
                 │  (pure library)   │                │     templates      │
                 └──────┬────────────┘                └────────────────────┘
                        │ also called by
                 ┌──────▼───────┐   HTTP   ┌──────────────┐
                 │  apps/api    │ ◄─────── │   apps/web   │  Next.js 15 UI
                 │ (thin server)│          │ (App Router) │
                 └──────────────┘          └──────────────┘
```

- **`packages/core`** — the generation engine. A **pure library**: no web
  framework, no server, no process/Node-server coupling. Everything that turns
  an input into MCP server source lives here so it is reusable by the CLI, the
  API, and tests.
- **`packages/cli`** — the `mcpgen` command. Stays **thin**: parse args, call
  `core`, write files. Built with **commander**.
- **`packages/templates`** — the source templates for the generated MCP server.
  `core` renders these; keep generated-code concerns out of `core`'s logic.
- **`apps/web`** — Next.js 15 App Router UI. Talks to `apps/api` over HTTP.
- **`apps/api`** — thin backend the web UI calls; delegates to `core`.

### Dependency rules

- `core` depends on nothing in this repo (it is the leaf).
- `cli` and `api` depend on `core` (and `core` on `templates` for rendering).
- `web` talks to `api` over HTTP — no direct import of `core`/`api` internals.

## Locked stack decisions

These are intentional and should not be swapped without a deliberate decision:

| Concern              | Choice                                                              |
| -------------------- | ------------------------------------------------------------------- |
| Package manager      | **pnpm** (workspaces)                                               |
| Monorepo task runner | **Turborepo**                                                       |
| Language             | **TypeScript**, `strict` mode, ESM                                  |
| Module system        | ESM everywhere (`"type": "module"`); libs compile with **NodeNext** |
| CLI framework        | **commander**                                                       |
| Web                  | **Next.js 15**, App Router, React 19                                |
| Lint                 | **ESLint flat config** + typescript-eslint                          |
| Format               | **Prettier**                                                        |
| Tests                | **Vitest** (configured at the repo root)                            |
| Node                 | **20+** (pinned via `.nvmrc` + `engines`)                           |

Shared TS settings live in `tsconfig.base.json`; each package/app extends it.

## Repo conventions

- Keep `core` pure — if you reach for `next`, `http`, or `fs`-heavy server code
  inside `core`, it probably belongs in `cli`/`api` instead.
- Cross-package imports use the package name (`@mcpgen/core`) and resolve to
  built `dist/` output; Turbo's `^build` ordering builds dependencies first.
- Tests are self-contained and import from `src` (not `dist`) so `pnpm test`
  works without a prior build (Vitest aliases `@mcpgen/*` to source).
- `apps/web`'s `typecheck` depends on its own `build` (see `apps/web/turbo.json`)
  so Next generates `next-env.d.ts` and `.next/types` first; that shim is
  git-ignored and regenerated, never committed.

## Phase plan

- **Phase 0 — Scaffolding (done).** Monorepo, tooling, CI, empty packages,
  placeholder web/api, trivial passing tests. **No generation logic.**
- **Phase 1 — Input ingestion (current).** Deterministic, LLM-free parsing in
  `packages/core`, behind a common `Source` interface, normalizing every input
  to the shared IR (`ToolCandidate[]` + `SourceMetadata`). All three parsers
  landed together: OpenAPI 3.0/3.1 (`@readme/openapi-parser`), GraphQL
  SDL/introspection (`graphql`), and Express/Fastify code (`ts-morph`,
  best-effort + low-confidence). CLI: `mcpgen inspect <source>` prints a
  tool-candidate table. IR lives in `packages/core/src/ir.ts`; fixtures in
  `packages/core/test/fixtures`. **No rendering yet — `templates` stays empty.**
- **Phase 2 — Render engine + `generate`.** Render the IR into typed MCP server
  source via `packages/templates`. CLI: `mcpgen generate`.
- **Phase 3 — Web UI + API.** Wire `apps/web` to `apps/api` for an in-browser
  generate-and-download flow.
- **Phase 4 — Deploy targets.** One-command deploy of generated servers.

> When starting a new phase, update this section and the locked-stack table if a
> decision genuinely changes — don't let the docs drift from the code.

## Verify locally

```bash
pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test
```
