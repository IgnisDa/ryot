FROM oven/bun:1.3.9-debian AS base
WORKDIR /app

FROM base AS prepare
RUN bun install --global turbo@2.8.10
COPY . .
RUN turbo prune @ryot/app-frontend --docker

FROM base AS builder
COPY --from=prepare /app/out/json/ .
# Use --ignore-scripts to avoid node-gyp build failures for optional native addons
# msgpackr-extract (optional dependency of BullMQ) tries to compile C++ bindings but:
# 1. Bun often hangs downloading Node.js headers for compilation (known issue #15881)
# 2. The native addon is optional - msgpackr works fine with pure JS fallback
# 3. Performance impact is negligible (~5% on serialization operations)
# See: https://github.com/oven-sh/bun/issues/12919
RUN bun install --frozen-lockfile --ignore-scripts
COPY --from=prepare /app/out/full/ .
RUN bun run --filter @ryot/app-backend build
RUN bun run --filter @ryot/app-frontend build

FROM oven/bun:1.3.9-debian AS runner
RUN useradd -m -u 1001 ryot
WORKDIR /home/ryot
COPY --chown=ryot:ryot apps/app-backend/drizzle ./drizzle
COPY --from=builder --chown=ryot:ryot /app/apps/app-backend/dist ./dist
COPY --from=builder --chown=ryot:ryot /app/apps/app-frontend/dist/client ./client
USER ryot
ENV NODE_ENV=production
CMD ["bun", "run", "dist/index.js"]
