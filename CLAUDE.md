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

| Concern              | Choice                                                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package manager      | **pnpm** (workspaces)                                                                                                                                                                  |
| Monorepo task runner | **Turborepo**                                                                                                                                                                          |
| Language             | **TypeScript**, `strict` mode, ESM                                                                                                                                                     |
| Module system        | ESM everywhere (`"type": "module"`); libs compile with **NodeNext**                                                                                                                    |
| CLI framework        | **commander**                                                                                                                                                                          |
| CLI prompts / color  | **@clack/prompts** (wizard + spinners), **picocolors** (color)                                                                                                                         |
| Web                  | **Next.js 15**, App Router, React 19                                                                                                                                                   |
| Web styling          | **Tailwind v4** (`@theme` tokens) + hand-vendored shadcn-style primitives (cva/clsx/tailwind-merge), **lucide-react** icons — no Radix                                                 |
| API server           | standalone **`node:http`** (no framework), **jszip** for downloads                                                                                                                     |
| E2E tests            | **Playwright** (`apps/web/e2e`, runs against the `MCPGEN_FAKE` API)                                                                                                                    |
| Lint                 | **ESLint flat config** + typescript-eslint                                                                                                                                             |
| Format               | **Prettier**                                                                                                                                                                           |
| Tests                | **Vitest** (repo root); coverage via **@vitest/coverage-v8** (enforced thresholds); property tests via **fast-check**                                                                  |
| Security CI          | **secure-MCP audit lint** (`scripts/security-lint.mjs`), **pnpm audit**, **CodeQL** (security-extended), **Dependabot**                                                                |
| Node                 | dev/CI need **22+** (`.nvmrc` pins 22; pnpm 11.8 requires Node ≥22.13); published CLI + generated servers target **20+**; web/api Docker images run **node:22-alpine**                  |
| Containers           | **Docker** multi-stage (web → Next `standalone`); root **`docker-compose.yml`** for web+api local bring-up                                                                             |
| Deploy targets       | Generated servers ship **Docker Compose + Fly + Render + Railway** configs; CLI publishes to **npm** as `mcpgenx` (name `mcpgen` was taken; bin stays `mcpgen`), web image to **GHCR** |
| Docs site            | **Nextra 4** (Next.js 15 App Router) in `apps/docs`; MDX in `content/`. Pinned to **zod 4.3.x** in its subtree (theme incompatible with zod ≥ 4.4)                                     |

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
- **Phase 1 — Input ingestion (done).** Deterministic, LLM-free parsing in
  `packages/core`, behind a common `Source` interface, normalizing every input
  to the shared IR (`ToolCandidate[]` + `SourceMetadata`). All three parsers
  landed together: OpenAPI 3.0/3.1 (`@readme/openapi-parser`), GraphQL
  SDL/introspection (`graphql`), and Express/Fastify code (`ts-morph`,
  best-effort + low-confidence). CLI: `mcpgen inspect <source>` prints a
  tool-candidate table. IR lives in `packages/core/src/ir.ts`; fixtures in
  `packages/core/test/fixtures`.
- **Phase 2 — Generation engine + `generate` (done).** The LLM-powered
  engine in `packages/core/src/generate/` turns the IR into a complete, typed
  MCP server (MCP SDK v1.x, Zod, stdio + Streamable HTTP). The Anthropic API
  sits behind the `LlmClient` interface (`llm.ts`; key/model from env, never
  hardcoded; default `claude-opus-4-8`). Three stages: **plan** (`plan.ts` —
  Claude proposes the tool set; strict JSON validated with Zod + one corrective
  retry), **synthesize** (`synthesize.ts` — per-tool Zod input shape + handler
  body, with a deterministic IR-only fallback so generation never hard-fails),
  and **assemble** (`assemble.ts` — render real template files from
  `packages/templates/files/*.tmpl` into a project file map). Responses are
  content-addressed/cached for cheap, resumable re-runs (`cache.ts`). Generated
  code follows OWASP secure-MCP practice: every input is Zod-validated by the
  runtime, all upstream URLs are built in one safe `http.ts` (no raw
  interpolation), credentials come from env, and a `SECURITY.md` ships in the
  output. CLI: `mcpgen generate <source> --out <dir> [--transport http|stdio]
[--auth apikey|oauth|none] [--offline] [--model <id>]`. Tests replay one
  recorded LLM run from `packages/core/test/fixtures/llm/` via
  `ScriptedLlmClient`, so CI needs no API key.
- **Phase 3 — Verification & self-repair (done).** A loop in
  `packages/core/src/verify/` that _proves a generated server runs_ instead of
  just producing it. After generation it materializes the project into a temp
  dir and runs four stages: **install** deps, **build** (the project's own
  `tsc`), **boot** (spawn the stdio server and drive it with a real MCP client —
  `initialize` + `tools/list`, asserting the advertised tools match the plan),
  and **smoke** (call every tool with an IR-sampled input against a mocked
  upstream, asserting a well-formed MCP result). On the first failing stage it
  sends the error + the single offending file to Claude for a focused fix
  (`repair.ts`), applies the patch, and re-runs — up to `--max-repairs` (default
  3); on exhaustion it writes `VERIFICATION_REPORT.md` and exits non-zero. The
  mock-upstream layer is pluggable (`MockUpstreamFactory`; default derives canned
  responses from the IR output schemas) so verification never hits a real API,
  and the whole I/O boundary (install/build/run) sits behind a `Toolchain`
  interface — the real `NodeToolchain` shells out; tests inject a fake, mirroring
  how the model sits behind `LlmClient`. The MCP _client_ runs inside a driver
  script written into the project under test, using the SDK the project itself
  installed, so no MCP SDK dependency leaks into `core`. CLI: `mcpgen generate`
  gains `--verify` (default on; `--no-verify` to skip) and `--max-repairs <n>`,
  and streams per-stage status. Loop tests (`verify.test.ts`) cover a clean pass,
  a build failure that gets repaired, and a budget exhaustion, all offline via
  the fake toolchain + `MockLlmClient`; the real toolchain is exercised by
  running `generate --verify` on the petstore fixture (needs a network install).
- **Phase 4 — CLI polish & DX (done).** Turn the CLI into a finished,
  trustworthy front end while keeping all logic in `core`. New commands:
  **`mcpgen init`** — a guided wizard (`packages/cli/src/init.ts`, built on
  `@clack/prompts`) that prompts for source → transport → auth → output, then
  runs generation with a live spinner and a final summary panel + copy-paste
  next steps; **`mcpgen doctor`** — environment checks (Node version, Anthropic
  key, Docker) whose logic lives in `packages/core/src/doctor.ts` as a pure
  `runDoctor()` returning a structured `DoctorReport` (the Docker probe is
  injectable, like `Toolchain`/`LlmClient`, so tests run offline); and
  **`mcpgen completion <bash|zsh|fish>`** — static shell completion scripts.
  `generate` and `doctor`/`inspect` gain `--json` for scripting, and all
  commands print **friendly, actionable errors** (`packages/cli/src/ui.ts`
  `friendlyError` maps core's typed errors + `ENOENT` to suggested fixes).
  Presentation (color via `picocolors`, boxed panels, spinners) is isolated in
  `ui.ts`; the command modules stay orchestration-only. The generated project's
  `README.md` now ships copy-paste run/deploy instructions and a "connect to
  Claude Desktop / Cursor / VS Code" section with exact MCP config JSON (the
  config is derived in `assemble.ts` and rendered via the `{{CONNECT_SECTION}}`
  token — `mcpServers` for Claude/Cursor, `servers` for VS Code, command/args
  for stdio or a `type:http` URL for http). Tests: core `doctor.test.ts` +
  README connect assertions in `engine.test.ts`; CLI `completion.test.ts`,
  `ui.test.ts`, expanded `program.test.ts`, and a hermetic child-process
  `cli.e2e.test.ts` that builds the binary via Turbo and drives the offline
  paths. A scripted demo lives in `docs/demo.md`.
- **Phase 5 — Web UI + API (done).** The public, in-browser
  generate-and-download flow. **`apps/api`** is a standalone `node:http` service
  (no framework, matching the repo) exposing `POST /api/parse`, `POST /api/jobs`,
  `GET /api/jobs/:id` (+ `/events` SSE, `/files`, `/download` zip, `/config`),
  and `/api/health`. The browser never sends a path: it pastes spec/schema text
  or an http(s) URL the server fetches (`parse.ts` sniffs the kind, mirroring
  core's path-based `detect.ts`, and applies the review-panel edits to the IR).
  Generation runs as an **in-memory job** (`jobs.ts` — concurrency-limited queue,
  buffered events so late SSE subscribers catch up, TTL eviction); the runner
  (`runner.ts`) drives `@mcpgen/core` and forwards `verifyProject` events onto a
  serializable `JobEvent` stream (`protocol.ts`). The Anthropic key is read from
  the server env only and never reaches the browser; requests are **IP
  rate-limited** (`ratelimit.ts`, fixed-window) and verification sandboxes in
  core's self-cleaning temp dir. A deterministic **`fakeRunner`** (enabled by
  `MCPGEN_FAKE=1`) mirrors the real event shape exactly so tests/demo run with no
  LLM, install, or toolchain. **`apps/web`** is Next.js 15 / React 19 with a
  custom Tailwind v4 design system (oklch color system, modular type scale,
  blueprint-grid canvas, electric-mint signal color — `app/globals.css`), not
  stock shadcn; UI primitives are hand-vendored in `components/ui/` (cva + clsx +
  tailwind-merge, no Radix). The page is a landing section (hero + looping
  `DemoLoop` + "what is MCP") above a 4-step generator (`components/generator/`):
  source → editable review → configure (transport/auth/AI/verify) → live SSE
  progress → result (file-tree code viewer, Download .zip, Copy Claude Desktop
  config, Phase-6 deploy preview). Web talks to the API over HTTP only
  (`lib/api.ts` + a duplicated `lib/protocol.ts` — it must not import API/core
  internals), base URL via `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`).
  Tests: api `server.test.ts` (parse, full job over SSE, zip magic bytes,
  config, rate-limit) + `ratelimit.test.ts`; web Playwright `e2e/generate.spec.ts`
  drives the whole happy path against the fake runner (its `playwright.config.ts`
  boots both servers with `MCPGEN_FAKE=1`). NOTE: the run-directly guard in
  `apps/api/src/index.ts` uses `pathToFileURL` (not naive `file://${argv[1]}`)
  because the repo path contains a space.
- **Phase 6 — Deploy targets (done).** Make both the generated servers and
  mcpgen itself trivially deployable. **Generated servers:** assembly now emits a
  full deploy kit alongside the source — a `.dockerignore`, a `docker-compose.yml`
  (http transport + `/healthz` healthcheck), and `fly.toml` / `render.yaml` /
  `railway.json` templates, all probing `/healthz`. The server entry
  (`server.ts.tmpl`) gained a `/healthz` route, CORS middleware
  (`MCPGEN_CORS_ORIGIN`), Streamable-HTTP **DNS-rebinding protection**
  (`MCPGEN_ALLOWED_HOSTS` → `enableDnsRebindingProtection`/`allowedHosts`), and —
  when the source carries OAuth/bearer auth — an OAuth 2.1 **protected-resource
  discovery** route (`/.well-known/oauth-protected-resource`, RFC 9728) driven by
  the new `{{WELL_KNOWN_SECTION}}` token + `config.oauth`. The `Dockerfile` gained
  a `HEALTHCHECK`; the README gained a `{{DEPLOY_SECTION}}` with copy-paste
  Docker/Compose/Fly/Render/Railway steps and TLS/CORS/DNS-rebinding/OAuth
  hardening notes (all derived in `assemble.ts`). `engine.test.ts` asserts the
  deploy files + health/OAuth wiring; `verify/docker-smoke.test.ts` (opt-in via
  `MCPGEN_DOCKER_SMOKE=1`) actually `docker build`s a generated server and polls
  `/healthz`. **mcpgen itself:** `packages/cli` now publishes as **`mcpgenx`**
  (the unscoped name `mcpgen` was already taken on npm; the installed bin stays
  `mcpgen`, so `npx mcpgenx` works with no global install), with
  `@mcpgen/core` + `@mcpgen/templates` made publishable too (all `publishConfig`
  `access:public` + `provenance:true`, versioned `0.1.0`). `apps/web` builds to
  Next **standalone** output (`next.config.mjs`) with `apps/web/Dockerfile`;
  `apps/api` has `apps/api/Dockerfile`; the root **`docker-compose.yml`** brings
  up web+api with one command (`docker compose up --build`), defaulting to the
  fake runner so it boots with no Anthropic key. `.github/workflows/deploy.yml`
  builds+pushes the web image to GHCR on `main` and publishes the CLI to npm with
  provenance on a `v*` tag. Full guide in `docs/deployment.md`. NOTE: the
  web/api Docker images use **`node:22-alpine`** (corepack's pnpm 11 needs a
  newer Node builtin than Node 20 ships); the generated server's own Dockerfile
  stays on `node:20-alpine` since it uses plain `npm`, not pnpm.

- **Phase 7 — Testing & security hardening (done).** No new features — make
  what exists bulletproof before launch. **Coverage:** Vitest now runs with
  **`@vitest/coverage-v8`** (`pnpm test:coverage`) and enforces per-glob
  thresholds in `vitest.config.ts` — the generation engine
  (`packages/core/src/generate`) and verification loop
  (`packages/core/src/verify`) must stay ≥85% statements / ≥80% branches (both
  sit ~96%/~90% now). New `core` unit tests fill the gaps the engine had
  (`cache`, `llm`, `zodgen`, `plan`, `synthesize`, `toolchain`, `repair`, plus
  verify-loop branch tests). **Property tests** (`parsers/openapi.property.test.ts`,
  **fast-check**) generate thousands of valid OpenAPI docs and assert parser
  invariants (MCP-safe unique names, IR mirrors spec, required path params) and
  that every generated server passes the security audit. **Golden suite**
  (`generate/golden.test.ts`) generates servers for **6 real public OpenAPI
  specs** committed under `packages/core/test/fixtures/golden/` (petstore,
  petstore-expanded, uspto, api-with-examples, link-example, callback-example),
  proves each emits syntactically-valid TS (via the `typescript` transpiler) and
  passes the full verify loop under the mocked upstream — offline with a
  files-reading fake toolchain by default, or the real `NodeToolchain` under
  `MCPGEN_GOLDEN_REAL=1`. **Adversarial tests** (`generate/adversarial.test.ts`)
  confirm malformed specs reject cleanly (no hang/crash) and injection-y
  descriptions/param-names stay escaped (valid TS + clean audit; `{{TOKEN}}`s in
  user content are not re-expanded), and a 400-operation spec generates fine.
  **Secure-MCP audit** (`packages/core/src/security/audit.ts`, exported from
  core) encodes the OWASP checklist as an automated lint over a `path→contents`
  map: no-secret-in-logs, inputs-validated (Zod), no-shell-or-eval, no-raw-fetch,
  scoped-credentials, dns-rebinding-guard, review-surface. Rules are scoped
  (`generated` vs `any`) so the universal ones also lint mcpgen's own source.
  `scripts/security-lint.mjs` (`pnpm security:lint`) runs it over a generated
  project **and** over first-party source, exiting non-zero on any high finding.
  **Observability** (`packages/core/src/observability.ts`): a structured logger
  (`MCPGEN_LOG_LEVEL`, injectable sink) and **opt-in, PII-free telemetry**
  (`MCPGEN_TELEMETRY=1`; `redactTelemetry` allow-lists numbers/booleans/safe
  enums and drops paths/titles/keys), wired as no-op hooks in `generateProject`
  and `verifyProject`. **CI:** `ci.yml` gained a `security` job
  (`pnpm audit --prod --audit-level=high` + `pnpm security:lint`) and switched
  tests to `test:coverage`; new `codeql.yml` (security-extended) and
  `dependabot.yml` (npm + actions). **Docs:** root `SECURITY.md` (disclosure
  policy) + `THREAT_MODEL.md` (STRIDE-framed, maps each control to code).

- **Phase 8 — Docs, landing polish & launch kit (done, final phase).** No engine
  changes — make the project legible and launch-ready. **Docs site:** a new
  **`apps/docs`** workspace is a **Nextra 4** site on Next 15 App Router (catch-all
  `app/[[...mdxPath]]/page.jsx` + `app/layout.jsx` + `mdx-components.js`; MDX in
  `content/` with `_meta.js` nav). Pages: Introduction, Quickstart, Concepts (IR +
  generation + verification), Guides (`guides/{openapi,graphql,codebase,transport,
auth,deploying}`), Connect to a client (Claude Desktop/Cursor/VS Code),
  Architecture (with the monorepo diagram), Contributing. It builds + typechecks
  via Turbo (`apps/docs/turbo.json` makes typecheck depend on build, like web).
  NOTE: **nextra-theme-docs 4.6 is incompatible with zod ≥ 4.4** — its `Layout`
  strips `children` before validating against a schema that still requires it, and
  zod 4.4 rejects the now-missing key (older zod treated a missing `z.custom` key
  as present, throwing the "expected nonoptional, received undefined → at children"
  error). Fixed by a **scoped pnpm override in `pnpm-workspace.yaml`**
  (`nextra>zod` / `nextra-theme-docs>zod` → `4.3.5`) so only the Nextra subtree
  downgrades; `packages/core` + `apps/api` keep zod 4.4.x (what the Anthropic SDK
  is built against). pnpm 11 reads overrides from `pnpm-workspace.yaml`, **not**
  `package.json`. An explicit `app/not-found.jsx` is required or the `/_not-found`
  prerender fails. **README:** rewritten into a launch landing — one-liner, badge
  row (CI/CodeQL/npm/node/license/stars), inline `docs/assets/demo.svg` terminal
  cast, "why this exists", 3-line quickstart, feature bullets, a "why not
  hand-write it?" comparison table, the pipeline diagram, monorepo table, and a
  roadmap (stateless Streamable HTTP for the 2026-07-28 spec + Python/FastMCP
  output). **Launch kit:** `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1),
  `CHANGELOG.md` (Keep-a-Changelog, `0.1.0`), refreshed `CONTRIBUTING.md`,
  `.github/ISSUE_TEMPLATE/{bug_report,feature_request}.yml` + `config.yml`,
  `.github/PULL_REQUEST_TEMPLATE.md`, `.github/labels.yml`, an idempotent
  `scripts/seed-issues.sh` (gh CLI — creates labels + **5 seeded
  `good first issue`s**; not auto-run against the live repo), and a launch
  checklist in `docs/launch.md`. The demo asset is a hand-written SVG terminal;
  replace it with a real asciinema GIF before posting (see `docs/launch.md`).

> When starting a new phase, update this section and the locked-stack table if a
> decision genuinely changes — don't let the docs drift from the code.

## Verify locally

```bash
pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test
```

Phase 7 adds two more gates (also run in CI):

```bash
pnpm test:coverage   # enforces engine + verify coverage thresholds
pnpm security:lint   # OWASP secure-MCP audit over generated output + own source (needs a prior build)
```
