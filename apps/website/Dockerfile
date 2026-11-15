FROM oven/bun:1.4.4-debian AS base
WORKDIR /app

FROM base AS pruner
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=cache,target=/root/.bun/install/cache \
    bun install --global "turbo@$(bun -p 'require("./package.json").devDependencies.turbo')"
COPY . .
RUN turbo prune @ryot-app/website --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.options.json /app/bunfig.toml ./
RUN bun run turbo build --filter=@ryot-app/website

FROM base AS runtime-deps
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --filter @ryot-app/website --production --linker hoisted --ignore-scripts --frozen-lockfile

FROM base
ENV NODE_ENV=production
RUN useradd -m -u 1001 ryot
COPY --from=runtime-deps /app/ ./
COPY --from=pruner /app/out/full/packages ./packages
WORKDIR /app/apps/website
COPY --from=builder /app/apps/website/build ./build
COPY apps/website/app/drizzle/migrations app/drizzle/migrations
RUN mkdir tmp && chown ryot:ryot tmp
USER ryot
CMD ["bun", "--bun", "run", "react-router-serve", "./build/server/index.js"]
