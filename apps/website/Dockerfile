ARG NODE_BASE_IMAGE=node:24.4.0-bookworm-slim

FROM --platform=$BUILDPLATFORM $NODE_BASE_IMAGE AS node-build-base

FROM node-build-base AS website-build-base
ENV MOON_TOOLCHAIN_FORCE_GLOBALS=true
WORKDIR /app
RUN apt update && apt install -y --no-install-recommends git curl ca-certificates xz-utils
RUN npm install -g @moonrepo/cli@1.39.2 && moon --version

FROM website-build-base AS website-workspace
WORKDIR /app
COPY . .
RUN moon docker scaffold website

FROM website-build-base AS website-builder
WORKDIR /app
COPY --from=website-workspace /app/.moon/docker/workspace .
RUN moon docker setup
COPY --from=website-workspace /app/.moon/docker/sources .
RUN moon run website:build
RUN moon docker prune

FROM $NODE_BASE_IMAGE
RUN apt-get update && apt-get install -y --no-install-recommends wget curl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
RUN useradd -m -u 1001 ryot
WORKDIR /home/ryot
COPY --from=website-builder --chown=ryot:ryot /app/apps/website/node_modules ./node_modules
COPY --from=website-builder --chown=ryot:ryot /app/apps/website/package.json ./package.json
COPY --from=website-builder --chown=ryot:ryot /app/apps/website/build ./build
COPY --chown=ryot:ryot apps/website/app/drizzle/migrations app/drizzle/migrations
CMD mkdir -p tmp && npx react-router-serve ./build/server/index.js
