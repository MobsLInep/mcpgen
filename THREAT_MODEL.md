# mcpgen Threat Model

This document describes what mcpgen protects, who it protects against, the
trust boundaries in the system, and the concrete controls that enforce each
decision. It is a living document; update it when the architecture changes.

It uses a lightweight STRIDE framing (Spoofing, Tampering, Repudiation,
Information disclosure, Denial of service, Elevation of privilege).

## 1. System overview

mcpgen turns an **OpenAPI spec, GraphQL schema, or code repo** into a typed,
deployable **MCP server**. It runs in three contexts:

- **CLI** (`mcpgen`) — a developer runs it locally against files on disk.
- **API + Web** (`apps/api`, `apps/web`) — a public, in-browser
  generate-and-download flow.
- **Generated servers** — the output, run later by an operator and called by an
  AI agent.

The generation engine (`@mcpgen/core`) is a pure library shared by all three.
A single LLM boundary (`LlmClient`) and a single toolchain boundary
(`Toolchain`) isolate the two risk-bearing external interactions (the model and
process execution).

## 2. Assets

| Asset                          | Why it matters                                          |
| ------------------------------ | ------------------------------------------------------- |
| **Anthropic API key**          | Paid credential; must never reach the browser or logs.  |
| **Upstream API credentials**   | The keys a generated server uses; env-only, never baked in. |
| **Source spec / schema**       | May be private/internal; must not leak via telemetry/logs. |
| **The host running verification** | The loop installs + executes generated code on it.   |
| **The generated code**         | Other people deploy it; insecure output is a supply-chain risk. |
| **The public API host**        | Internet-facing; subject to SSRF, abuse, resource exhaustion. |

## 3. Trust boundaries

```
 ┌─ developer's machine ────────────────────────────────────────────┐
 │  files ─► CLI ─► core ─► [LlmClient]──► Anthropic API  (boundary) │
 │                    │                                               │
 │                    └─► [Toolchain] ─► child process: npm/tsc/node  │
 │                                        (boundary: code execution)  │
 └───────────────────────────────────────────────────────────────────┘

 ┌─ browser ─┐   HTTP    ┌─ apps/api (server) ─► core ─► … same boundaries ┐
 │  user     │ ────────► │  (boundary: untrusted network input)            │
 └───────────┘           └──────────────────────────────────────────────────┘

 generated server ─► [http.ts] ─► upstream third-party API  (boundary)
```

The four boundaries that carry the most risk: **(a)** the network edge of the
public API, **(b)** the LLM call, **(c)** process execution in the verification
loop, and **(d)** the generated server's calls to the upstream API.

## 4. Threats and controls

### 4.1 Injection from spec → generated code (Tampering / EoP)

**Threat.** A hostile spec embeds code in a description, title, or parameter
name (`"; doEvil(); //`, `${process.env.SECRET}`, `*/ … /*`) hoping it becomes
executable TypeScript in the generated server.

**Controls.**
- All user-derived strings are emitted via `JSON.stringify` literals; identifiers
  are sanitized (`sanitizeToolName`) or quoted (`propertyKey`). Tool input is
  read from `args` by bracketed index, never spliced into code.
- Template rendering is a single non-recursive `{{TOKEN}}` pass, so `{{…}}`
  hidden in user content is **not** re-expanded.
- `adversarial.test.ts` feeds injection payloads through and asserts every
  generated file still parses as valid TypeScript (a breakout would unbalance a
  string literal and fail to parse) and that the secure-MCP audit stays clean.

### 4.2 Credential leakage (Information disclosure)

**Threat.** The Anthropic key or an upstream credential leaks via logs,
telemetry, the browser, or generated code.

**Controls.**
- The Anthropic key is resolved from the environment only (`resolveApiKey`) and
  is read **server-side only** in the API; it never crosses to the browser.
- Generated servers read credentials from env (`config.ts`) and attach them in
  exactly one place (`http.ts`); the `scoped-credentials` audit rule fails the
  build on a hardcoded secret, and `no-secret-in-logs` fails on a secret reaching
  a log sink.
- **Telemetry is opt-in** (`MCPGEN_TELEMETRY=1`) and PII-free: every property is
  passed through `redactTelemetry`, an allow-list that keeps only numbers,
  booleans, and low-cardinality enums — spec content, paths, titles, and keys are
  dropped (`observability.test.ts`).

### 4.3 Code execution in verification (EoP / DoS)

**Threat.** Verification installs and runs generated code; a malicious spec could
try to abuse that to run arbitrary commands or exhaust the host.

**Controls.**
- All process execution goes through the `Toolchain` boundary. The real
  `NodeToolchain` spawns fixed commands with **argv arrays** (no shell string),
  so there is no shell-injection surface; every stage has a timeout.
- Verification runs in a self-cleaning OS temp dir, removed in a `finally` block.
- The mock-upstream layer means smoke tests **never** hit a real third-party API.
- The audit's `no-shell-or-eval` rule guarantees generated handlers contain no
  process/eval sinks; `no-dynamic-eval` enforces the same for mcpgen's own code
  (which only ever uses safe argv subprocesses).
- *Residual risk:* `npm install` runs third-party install scripts. Treat
  verification of an untrusted spec as running untrusted code — run it in a
  container/VM. This is documented for operators.

### 4.4 SSRF and abuse of the public API (Information disclosure / DoS)

**Threat.** The browser submits an `http(s)` URL the server fetches; an attacker
points it at internal metadata endpoints, or floods the generate endpoint.

**Controls.**
- The fetcher (`parse.ts`) bounds response size and rejects non-OK responses;
  the browser never sends a filesystem path.
- The API is **IP rate-limited** (fixed-window) on parse and job creation.
- Generation runs as a concurrency-limited, TTL-evicted in-memory job; the
  Anthropic key stays in the server env.
- *Hardening note:* deployments that can reach sensitive internal hosts should
  add an egress allow-list / block private IP ranges in front of the fetcher.

### 4.5 Insecure generated-server defaults (EoP)

**Threat.** A generated server is deployed publicly without hardening and is hit
by DNS-rebinding, open CORS, or unauthenticated access.

**Controls.**
- The Streamable HTTP transport wires `enableDnsRebindingProtection` (enforced by
  the `dns-rebinding-guard` audit rule), supports an `MCPGEN_ALLOWED_HOSTS`
  allow-list and configurable `MCPGEN_CORS_ORIGIN`, and serves OAuth 2.1
  protected-resource metadata when the source declares OAuth/bearer auth.
- Every generated project ships a `SECURITY.md` review checklist (enforced by the
  `review-surface` rule) and a `DEPLOY` section spelling out TLS / CORS /
  rebinding / OAuth steps before going public.

### 4.6 Supply chain (Tampering)

**Threat.** A compromised dependency or a tampered published artifact.

**Controls.**
- `pnpm audit` (high/critical) gates CI; **Dependabot** opens update PRs for npm
  and GitHub Actions; **CodeQL** (security-extended) runs on every push/PR.
- Published packages use npm **provenance** (`publishConfig.provenance`), and the
  lockfile is committed and installed with `--frozen-lockfile`.

## 5. Assumptions & non-goals

- The developer running the CLI is trusted on their own machine; mcpgen does not
  defend against a local attacker who already controls it.
- mcpgen does not vouch for the security of the upstream APIs a generated server
  calls, nor for the MCP client that connects to it.
- Verifying a spec you do not trust is equivalent to running untrusted code;
  isolate it.

## 6. Where the controls live

| Control                         | Code / config                                   |
| ------------------------------- | ----------------------------------------------- |
| Secure-MCP audit                | `packages/core/src/security/audit.ts`           |
| Security lint (CI gate)         | `scripts/security-lint.mjs`, `.github/workflows/ci.yml` |
| Opt-in PII-free telemetry       | `packages/core/src/observability.ts`            |
| Safe URL/credential handling    | `packages/templates/files/http.ts.tmpl`, `config.ts.tmpl` |
| Verification sandbox boundary   | `packages/core/src/verify/toolchain.ts`         |
| Adversarial / property / golden tests | `packages/core/src/**/*.test.ts`          |
| Dependency / CodeQL / Dependabot | `.github/workflows/`, `.github/dependabot.yml` |
