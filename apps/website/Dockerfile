ARG NODE_BASE_IMAGE=oven/bun:1.3.9-debian

FROM --platform=$BUILDPLATFORM $NODE_BASE_IMAGE AS website-build-base
WORKDIR /app
RUN apt update && apt install -y --no-install-recommends git curl ca-certificates xz-utils

FROM website-build-base AS website-pruner
WORKDIR /app
# Use the exact version from the root package.json
RUN npm install -g turbo@2.8.10
COPY . .
RUN turbo prune @ryot/website --docker

FROM website-build-base AS website-builder
WORKDIR /app
COPY --from=website-pruner /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=website-pruner /app/out/full/ .
COPY --from=website-pruner /app/tsconfig.options.json .
RUN bun run turbo build --filter=@ryot/website
RUN bun install --filter @ryot/website --production

FROM $NODE_BASE_IMAGE
RUN apt-get update && apt-get install -y --no-install-recommends wget curl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
RUN useradd -m -u 1001 ryot
WORKDIR /home/ryot
COPY --from=website-builder --chown=ryot:ryot /app/apps/website/node_modules ./node_modules
COPY --from=website-builder --chown=ryot:ryot /app/apps/website/package.json ./package.json
COPY --from=website-builder --chown=ryot:ryot /app/apps/website/build ./build
COPY --chown=ryot:ryot apps/website/app/drizzle/migrations app/drizzle/migrations
USER ryot
CMD ["sh", "-c", "mkdir -p tmp && exec bun run react-router-serve ./build/server/index.js"]
