FROM oven/bun:1.3.9-debian AS backend-builder
WORKDIR /app
COPY apps/app-backend/package.json apps/app-backend/tsconfig.json ./
COPY apps/app-backend/src ./src
RUN bun install && bun run build

FROM oven/bun:1.3.9-debian AS frontend-builder
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/app-frontend/package.json ./apps/app-frontend/
COPY apps/app-backend/package.json ./apps/app-backend/
RUN bun install --frozen-lockfile
COPY apps/app-frontend ./apps/app-frontend
COPY apps/app-backend/src ./apps/app-backend/src
COPY tsconfig.options.json ./
RUN bun run --filter @ryot/app-frontend build

FROM oven/bun:1.3.9-debian
RUN useradd -m -u 1001 ryot
WORKDIR /home/ryot
COPY --from=backend-builder --chown=ryot:ryot /app/dist ./dist
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/app-frontend/dist/client ./client
COPY --chown=ryot:ryot apps/app-backend/drizzle ./drizzle
USER ryot
ENV NODE_ENV=production
CMD ["bun", "run", "dist/index.js"]
