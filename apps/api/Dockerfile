# syntax=docker/dockerfile:1
# API image for mcpgen. Build from the REPO ROOT (it needs the pnpm workspace),
# e.g.  docker build -f apps/api/Dockerfile -t mcpgen-api .
# Node 22: pnpm 11 (via corepack) needs a newer runtime than Node 20 ships.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# --- build: install the workspace and compile the API + its deps ---
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# `@mcpgen/api...` builds @mcpgen/api and everything it depends on (core,
# templates) in dependency order.
RUN pnpm --filter "@mcpgen/api..." build

# --- runner: the built workspace, run straight from dist ---
# Workspace links in node_modules resolve @mcpgen/core → packages/core/dist, so
# the compiled API runs without a publish step.
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3001
# Default to the deterministic fake runner so the container boots with no API
# key; override to 0 (and pass ANTHROPIC_API_KEY) for real generation.
ENV MCPGEN_FAKE=1
COPY --from=build /app ./
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
