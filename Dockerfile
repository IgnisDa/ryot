FROM oven/bun:1.3.9-debian AS backend-builder
WORKDIR /app
COPY apps/app-backend/package.json apps/app-backend/tsconfig.json ./
COPY apps/app-backend/src ./src
RUN bun install && bun run build

FROM oven/bun:1.3.9-debian
RUN useradd -m -u 1001 ryot
WORKDIR /home/ryot
COPY --from=backend-builder --chown=ryot:ryot /app/dist ./dist
COPY --chown=ryot:ryot apps/app-backend/drizzle ./drizzle
USER ryot
ENV NODE_ENV=production
CMD ["bun", "run", "dist/index.js"]
