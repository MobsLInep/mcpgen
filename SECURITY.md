# Security Policy

mcpgen generates code that other people run, and it handles API specifications
and credentials in the process. We take its security seriously and welcome
reports from the community.

> This policy covers **mcpgen itself** (the CLI, `@mcpgen/core`,
> `@mcpgen/templates`, the web app, and the API). The MCP servers mcpgen
> *generates* each ship their own `SECURITY.md` review checklist for the
> operator who deploys them.

## Supported versions

mcpgen is pre-1.0 and ships from `main`. Security fixes land on the latest
released `0.x` line and are published to npm / GHCR.

| Version    | Supported          |
| ---------- | ------------------ |
| `0.1.x`    | ✅ yes             |
| `< 0.1.0`  | ❌ no              |

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security problem.**

Report privately through either channel:

1. **GitHub Security Advisories** — preferred. Go to the repository's
   **Security → Advisories → Report a vulnerability** and file a private
   advisory. This keeps the discussion confidential until a fix ships.
2. **Email** — `security@mcpgen.dev` (or, until that alias is live, the
   maintainer address in `package.json`). Use a subject prefixed `[SECURITY]`.

Please include:

- the affected component (CLI / core / api / web / a generated server),
- the version or commit,
- a description and, ideally, a minimal reproduction,
- the impact you believe it has.

If you can, encrypt sensitive details; ask in your first message and we will
share a key.

## What to expect

| Stage                 | Target                                      |
| --------------------- | ------------------------------------------- |
| Acknowledgement       | within **3 business days**                  |
| Initial assessment    | within **7 business days**                  |
| Fix or mitigation plan | within **30 days** for high/critical issues |
| Public disclosure     | coordinated, after a fix is available       |

We practice **coordinated disclosure**: we will agree a timeline with you,
credit you in the advisory and release notes (unless you prefer to remain
anonymous), and let you know when the fix is out.

## Scope

In scope:

- Code execution, privilege escalation, or sandbox escape in the **verification
  loop** (`@mcpgen/core`'s `verify/`), which builds and boots generated code.
- **Credential leakage** — any path by which an API key, token, or spec content
  could be logged, written to disk unexpectedly, sent to the model, or returned
  to the browser.
- **Injection** into generated code — input from a spec breaking out of a string
  literal into executable TypeScript.
- Vulnerabilities in the **web app / API** (SSRF via the spec-URL fetcher,
  rate-limit bypass, etc.).
- Insecure defaults in the **generated server templates**.

Out of scope:

- Vulnerabilities in a *third-party API* that a generated server talks to.
- Findings that require a malicious local user who already controls the machine.
- Missing hardening that the generated `SECURITY.md` already flags for the
  operator to configure (e.g. setting `MCPGEN_ALLOWED_HOSTS` before exposing an
  http server publicly).
- Reports from automated scanners with no demonstrated impact.

## Safe harbor

We will not pursue or support legal action against researchers who:

- make a good-faith effort to follow this policy,
- avoid privacy violations, data destruction, and service degradation,
- only interact with accounts/systems they own or have explicit permission to
  test.

## Our own controls

Security is enforced in CI, not just documented:

- **Secure-MCP audit** (`pnpm security:lint`) — the OWASP secure-MCP checklist
  runs as an automated lint over generated output *and* over mcpgen's own
  source, failing the build on any high-severity finding.
- **Dependency scanning** — `pnpm audit` gates CI; Dependabot opens update PRs.
- **CodeQL** — static analysis (security-extended queries) on every push/PR.
- **Tests** — property-based, golden-file, and adversarial suites prove the
  parser and generator fail safely on malformed and hostile input.

See [`THREAT_MODEL.md`](./THREAT_MODEL.md) for the full threat model.
