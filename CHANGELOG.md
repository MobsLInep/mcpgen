# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-06-23

The first public release of **mcpgen** — generate a working, typed, deployable
MCP server from an OpenAPI spec, GraphQL schema, or code repo.

### Added

- **Input ingestion** — deterministic, LLM-free parsers for OpenAPI 3.0/3.1,
  GraphQL (SDL + introspection), and Express/Fastify code, all normalized to a
  shared IR (`ToolCandidate[]` + metadata). `mcpgen inspect <source>` prints the
  tool candidates.
- **Generation engine** — `mcpgen generate` turns the IR into a complete MCP
  server (MCP SDK v1.x, Zod, stdio + Streamable HTTP) in three stages: plan,
  synthesize, assemble. Claude sits behind an `LlmClient` interface; responses
  are content-addressed and cached. A deterministic offline mode (`--offline`,
  or no API key) always produces a buildable server.
- **Verification & self-repair** — generated servers are installed, built,
  booted, and smoke-tested against a mocked upstream, with model-driven repair of
  the first failing stage (`--verify` on by default, `--max-repairs`).
- **CLI & DX** — `mcpgen init` (guided wizard), `mcpgen doctor` (environment
  checks), `mcpgen completion` (bash/zsh/fish), `--json` output, and friendly,
  actionable errors.
- **Web UI + API** — a Next.js 15 paste-and-download web app over a standalone
  `node:http` API, with live SSE progress and a deterministic fake runner for
  key-free demos.
- **Deploy kit** — every generated server ships a Dockerfile, `.dockerignore`,
  Docker Compose, and Fly / Render / Railway configs with a `/healthz` probe,
  CORS, DNS-rebinding protection, and OAuth 2.1 protected-resource discovery.
  mcpgen itself publishes the `mcpgen` CLI to npm and a web image to GHCR.
- **Security & testing** — an automated OWASP secure-MCP audit (`pnpm
security:lint`), enforced coverage thresholds, property tests (fast-check), a
  6-spec golden suite, adversarial tests, CodeQL, Dependabot, `SECURITY.md`, and
  a STRIDE `THREAT_MODEL.md`.
- **Docs & launch kit** — a Nextra 4 documentation site (`apps/docs`), a polished
  landing README, issue/PR templates, a Contributor Covenant Code of Conduct, and
  a seeded `good first issue` set.

[0.1.0]: https://github.com/MobsLInep/mcpgen/releases/tag/v0.1.0
