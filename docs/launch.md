# Launch checklist

Everything needed to take mcpgen public, in order. Boxes are sequenced: don't
post anywhere until the repo and release are solid.

## 0. Pre-flight (repo is shippable)

- [ ] `pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test` all green.
- [ ] `pnpm test:coverage` passes the thresholds; `pnpm security:lint` is clean.
- [ ] `pnpm --filter @mcpgen/docs build` succeeds (docs site builds).
- [ ] README renders correctly on GitHub — badges resolve, demo asset shows,
      links work.
- [ ] `LICENSE`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CONTRIBUTING.md`,
      `CHANGELOG.md` all present and current.
- [ ] Issue templates + PR template show up in the GitHub UI.
- [ ] Replace `docs/assets/demo.svg` with a real terminal GIF/cast
      (`asciinema rec` → [agg](https://github.com/asciinema/agg) → GIF) — see
      `docs/demo.md` for the command sequence.

## 1. Repo settings (GitHub)

- [ ] Add a concise description + topics: `mcp`, `model-context-protocol`,
      `openapi`, `graphql`, `code-generation`, `ai`, `typescript`, `cli`.
- [ ] Set the homepage to the docs URL once deployed.
- [ ] Enable **Discussions** (the issue-template config links to it).
- [ ] Enable **Dependabot** alerts + security updates (config already in repo).
- [ ] Confirm branch protection on `main` (require CI green before merge).
- [ ] Run `./scripts/seed-issues.sh` to create labels + the `good first issue` set.
- [ ] Pin 2–3 issues (a `good first issue`, a roadmap item).

## 2. Cut the release

- [ ] Versions are `0.1.0` in `packages/cli`, `packages/core`, `packages/templates`.
- [ ] `CHANGELOG.md` has the `0.1.0` entry dated correctly.
- [ ] Set the `NPM_TOKEN` repo secret (npm automation token) for provenance publish.
- [ ] Tag and push:
      `bash
    git tag v0.1.0 && git push origin v0.1.0
    `
- [ ] The **Deploy** workflow publishes `mcpgen` (+ `@mcpgen/core`,
      `@mcpgen/templates`) to npm and the web image to GHCR.
- [ ] Smoke-test the published package from a clean dir:
      `bash
    npx mcpgen@latest doctor
    npx mcpgen@latest generate ./openapi.yaml --out /tmp/test-server
    `
- [ ] Create the GitHub Release from the tag, pasting the changelog entry.

## 3. Deploy the docs + playground

- [ ] Deploy `apps/docs` (Vercel/Netlify/GitHub Pages) and set the repo homepage.
- [ ] Optionally deploy `apps/web` + `apps/api` (see `docs/deployment.md`) as a
      hosted "paste a spec, get a server" playground.

## 4. Announce

Lead with the one-liner — _"Turn any API into an MCP server an agent can actually
use"_ — and the 3-line quickstart. Attach the demo GIF everywhere.

- [ ] **GitHub Release** notes (the canonical announcement; link from everything).
- [ ] **Hacker News** — Show HN: _"mcpgen – generate a verified MCP server from
      an OpenAPI/GraphQL spec"_. Post mid-morning ET on a weekday; be around to
      answer comments. Lead with _why_ (MCP tooling is thin) + the demo.
- [ ] **Reddit** — r/LocalLLaMA, r/ClaudeAI, r/programming (read each sub's
      self-promo rules first).
- [ ] **X / Twitter** + **LinkedIn** — short thread: problem → demo GIF →
      quickstart → repo link.
- [ ] **MCP community** — the [Model Context Protocol](https://modelcontextprotocol.io)
      Discord/discussions; submit to MCP server/tool directories and
      `awesome-mcp` lists.
- [ ] **Dev.to / Hashnode** — a short "how it works" post linking the
      [Concepts](../apps/docs/content/concepts.mdx) page.
- [ ] **Bluesky / Mastodon** (`#MCP`, `#AI`, `#OpenAPI`).

## 5. Post-launch (first 48h)

- [ ] Watch issues/Discussions; triage with the new labels within a few hours.
- [ ] Reply to every HN/Reddit comment you reasonably can.
- [ ] Fast-follow a `v0.1.1` for any embarrassing first-run bug.
- [ ] Note recurring questions → fold them into docs (a troubleshooting page).
- [ ] Thank first contributors; keep a couple of `good first issue`s open.

## Messaging cheat-sheet

- **One-liner:** Turn any API into an MCP server an AI agent can actually use.
- **The hook:** It doesn't just generate — it installs, builds, boots, and
  smoke-tests the server before handing it to you.
- **The proof:** `npx mcpgen generate ./openapi.yaml --out ./my-server`
- **The differentiator:** OpenAPI **+** GraphQL **+** code, secure-by-default,
  works offline, deploy kit in the box.
