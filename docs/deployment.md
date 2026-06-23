# Deployment

Phase 6 makes two things trivially deployable: the **MCP servers mcpgen
generates**, and **mcpgen itself** (the CLI + the web app/API).

---

## 1. Deploying a generated server

Every project mcpgen emits is deploy-ready out of the box. Alongside the source
it writes:

| File                 | Purpose                                                         |
| -------------------- | --------------------------------------------------------------- |
| `Dockerfile`         | Hardened multi-stage build, with a `HEALTHCHECK` on `/healthz`. |
| `.dockerignore`      | Keeps the build context (and image) small.                      |
| `docker-compose.yml` | Local Compose service over the HTTP transport.                  |
| `fly.toml`           | Fly.io app config (build, env, `/healthz` check).               |
| `render.yaml`        | Render Blueprint (Docker build, health check, secret env vars). |
| `railway.json`       | Railway config (Dockerfile build, `/healthz` check).            |
| `.env.example`       | Every env var the server reads, documented.                     |

The server speaks **Streamable HTTP** at `/mcp` and answers a liveness probe at
`/healthz` (`{"status":"ok",...}`).

### Docker / Compose

```bash
docker build -t my-server .
docker run -p 3000:3000 --env-file .env my-server
# or:
docker compose up --build
curl http://localhost:3000/healthz
```

### Fly.io

```bash
fly launch --copy-config --no-deploy   # pick an app name + region
fly secrets set MCPGEN_API_BASE_URL=https://api.example.com MCPGEN_BEARER_TOKEN=...
fly deploy
```

### Render

Push the repo to GitHub, then **New + → Blueprint** and select it. `render.yaml`
wires the Docker build, the `/healthz` check, and the env vars (secrets entered
in the dashboard, marked `sync: false`).

### Railway

```bash
railway up   # uses railway.json
```

Set `MCPGEN_API_BASE_URL` and credentials in the Railway dashboard.

### Remote/production hardening

The generated server follows the MCP SDK's security guidance for remote
transports:

- **TLS** — terminate HTTPS at the platform edge (Fly/Render/Railway do this for
  you). Tokens then never travel in cleartext.
- **DNS-rebinding protection** — set `MCPGEN_ALLOWED_HOSTS` to your public
  domain(s). The Streamable HTTP transport then rejects requests whose `Host`
  header is not in the allow-list (`enableDnsRebindingProtection`).
- **CORS** — set `MCPGEN_CORS_ORIGIN` to your client's origin instead of `*`.
- **OAuth 2.1** — when the source uses OAuth/bearer auth, the server serves
  `/.well-known/oauth-protected-resource` (RFC 9728) so MCP clients can discover
  the authorization server. Point `MCPGEN_OAUTH_RESOURCE` and
  `MCPGEN_OAUTH_AUTH_SERVER` at your deployment.

### Smoke-testing the image

`packages/core/src/verify/docker-smoke.test.ts` builds a generated server's
Docker image and boots it, polling `/healthz`. It is opt-in (it needs Docker and
is slow):

```bash
MCPGEN_DOCKER_SMOKE=1 pnpm vitest run docker-smoke
```

---

## 2. Deploying mcpgen itself

### The CLI on npm (`npx mcpgenx`)

`packages/cli` publishes as **`mcpgenx`** (the unscoped name `mcpgen` was already
taken on npm) and installs the `mcpgen` command, so it runs with no global install:

```bash
npx mcpgenx generate ./openapi.yaml --out ./my-server
npx mcpgenx init        # guided wizard
```

Publishing is automated: pushing a `v*` tag runs the **Deploy** workflow's
`publish-cli` job, which builds and runs `pnpm -r publish --provenance` — this
publishes `mcpgenx`, `@mcpgen/core`, and `@mcpgen/templates` to npm with [build
provenance](https://docs.npmjs.com/generating-provenance-statements). It needs:

- repo secret `NPM_TOKEN` (an npm automation token), and
- `id-token: write` permission (already set in the workflow).

To cut a release:

```bash
# bump versions in the three package.json files, commit, then:
git tag v0.1.0
git push origin v0.1.0
```

### The web UI + API with Docker Compose

One command brings up both services locally:

```bash
docker compose up --build
```

- **web** → http://localhost:3000 (Next.js standalone image)
- **api** → http://localhost:3001 (`node:http` service)

The API defaults to the deterministic **fake runner** (`MCPGEN_FAKE=1`) so the
stack works with no Anthropic key. For real generation:

```bash
MCPGEN_FAKE=0 ANTHROPIC_API_KEY=sk-ant-... docker compose up --build
```

`NEXT_PUBLIC_API_URL` is baked into the web bundle at build time (default
`http://localhost:3001`); override it via the compose build arg or env when
deploying the web image behind a different API origin.

### The web image in CI

Every push to `main` builds and pushes the web image to GHCR via the **Deploy**
workflow's `web-image` job:

```
ghcr.io/<owner>/mcpgen-web:latest
ghcr.io/<owner>/mcpgen-web:sha-<commit>
```

Pull and run it against an existing API:

```bash
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  ghcr.io/<owner>/mcpgen-web:latest
```

(Rebuild with `--build-arg NEXT_PUBLIC_API_URL=https://api.example.com` to point
the browser bundle at a non-default API.)
