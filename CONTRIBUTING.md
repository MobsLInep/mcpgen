# Contributing to mcpgen

Thanks for your interest! mcpgen is an open-source project under active
construction. This is a stub — it will grow as the project matures.

## Prerequisites

- Node 20+ (`.nvmrc` pins the major version; run `nvm use`).
- pnpm 9+ (`corepack enable` will provide the pinned version).

## Local development

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

All four (`build`, `typecheck`, `lint`, `test`) must pass before opening a PR.
CI runs them on Node 20 and 22.

## Conventions

- TypeScript strict mode everywhere. No `any` without a justified `// eslint-disable`.
- Conventional Commits for messages (e.g. `feat:`, `fix:`, `chore:`, `docs:`).
- Keep `packages/core` a pure library — no Node-server or framework dependencies.
- Read [`CLAUDE.md`](./CLAUDE.md) before adding code so the stack stays consistent.

## Code of Conduct

Be kind. A formal Code of Conduct will be added before the first release.
