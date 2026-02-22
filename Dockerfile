FROM oven/bun:1.3.9-debian AS stager
WORKDIR /app
RUN bun install --global turbo@2.8.10
COPY . .
RUN turbo prune --scope=@ryot/app-backend --docker
RUN turbo prune --scope=@ryot/app-frontend --docker

FROM oven/bun:1.3.9-debian AS builder
WORKDIR /app
COPY --from=stager /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=stager /app/out/full/ .
RUN bun run --filter @ryot/app-backend build
RUN bun run --filter @ryot/app-frontend build

FROM oven/bun:1.3.9-debian
RUN useradd -m -u 1001 ryot
WORKDIR /home/ryot
COPY --from=builder --chown=ryot:ryot /app/dist ./dist
COPY --from=builder --chown=ryot:ryot /app/apps/app-frontend/dist/client ./client
COPY --chown=ryot:ryot apps/app-backend/drizzle ./drizzle
USER ryot
ENV NODE_ENV=production
CMD ["bun", "run", "dist/index.js"]
