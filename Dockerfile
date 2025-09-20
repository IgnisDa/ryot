FROM oven/bun:1.3.9-debian AS builder
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run --filter @ryot/app-backend build
RUN bun run --filter @ryot/app-frontend build

FROM oven/bun:1.3.9-debian
RUN useradd -m -u 1001 ryot
WORKDIR /home/ryot
COPY --chown=ryot:ryot apps/app-backend/drizzle ./drizzle
COPY --from=builder --chown=ryot:ryot /app/apps/app-backend/dist ./dist
COPY --from=builder --chown=ryot:ryot /app/apps/app-frontend/dist/client ./client
USER ryot
ENV NODE_ENV=production
CMD ["bun", "run", "dist/index.js"]
