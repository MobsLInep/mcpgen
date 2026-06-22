# syntax=docker/dockerfile:1
# Web UI image for mcpgen. Build from the REPO ROOT (it needs the pnpm
# workspace), e.g.  docker build -f apps/web/Dockerfile -t mcpgen-web .
# Node 22: pnpm 11 (via corepack) needs a newer runtime than Node 20 ships.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# --- build: install the workspace and produce Next's standalone output ---
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# NEXT_PUBLIC_* is inlined at build time, so the browser's API base URL must be
# known here. Override with --build-arg NEXT_PUBLIC_API_URL=https://api.example.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @mcpgen/web build

# --- runner: just Node + the traced standalone bundle ---
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
