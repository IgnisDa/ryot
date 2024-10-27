FROM oven/bun:1.3.9-debian AS base
WORKDIR /app

FROM base AS prepare
RUN bun install --global turbo@2.8.10
COPY . .
RUN turbo prune @ryot/app-frontend --docker

FROM base AS builder
COPY --from=prepare /app/out/json/ .
# Skip postinstall scripts to avoid native binary download failures in Docker
# msgpackr-extract (optional dep of BullMQ's msgpackr) fails to install its native bindings
# The packages work fine without postinstall - msgpackr falls back to pure JS implementation
RUN bun install --frozen-lockfile --ignore-scripts
COPY --from=prepare /app/out/full/ .
RUN bun run --filter @ryot/app-backend build
RUN bun run --filter @ryot/app-frontend build

FROM base AS runner
RUN useradd -m -u 1001 ryot
WORKDIR /home/ryot
COPY --chown=ryot:ryot apps/app-backend/drizzle ./drizzle
COPY --from=builder --chown=ryot:ryot /app/apps/app-backend/dist ./dist
COPY --from=builder --chown=ryot:ryot /app/apps/app-frontend/dist/client ./client
USER ryot
ENV NODE_ENV=production
CMD ["bun", "run", "dist/index.js"]
