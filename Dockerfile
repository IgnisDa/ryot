FROM oven/bun:1.4.2-debian AS base
WORKDIR /app

FROM rust:1.93.1-bookworm AS rust-toolchain

FROM base AS prepare
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --global turbo@2.10.12
COPY . .
RUN turbo prune @ryot-app/kernel-client @ryot-app/server --docker

FROM base AS builder-base
COPY --from=prepare /app/out/json/ .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install
COPY --from=prepare /app/out/full/ .
COPY --from=prepare /app/tsconfig.options.json ./tsconfig.options.json

FROM builder-base AS backend-builder
COPY --from=rust-toolchain /usr/local/cargo /usr/local/cargo
COPY --from=rust-toolchain /usr/local/rustup /usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo
ENV RUSTUP_HOME=/usr/local/rustup
ENV PATH=/usr/local/cargo/bin:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends build-essential ca-certificates python3 && \
    rm -rf /var/lib/apt/lists/*
ARG UNKEY_ROOT_KEY=""
ARG RYOT_VERSION="unknown"
ENV UNKEY_ROOT_KEY=$UNKEY_ROOT_KEY
ENV RYOT_VERSION=$RYOT_VERSION
RUN bun turbo --filter=@ryot-app/server build
RUN bun run --cwd apps/server assemble

FROM builder-base AS client-builder
ARG RYOT_VERSION="unknown"
ENV RYOT_VERSION=$RYOT_VERSION
RUN bun turbo --filter=@ryot-app/kernel-client build

FROM base AS runtime-deps
COPY --from=prepare /app/out/json/ .
COPY --from=prepare /app/out/full/packages ./packages
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --linker hoisted --filter @ryot-app/vite-compiler --filter @ryot-app/typescript-compiler --filter @ryot-app/sandbox-compiler --filter @ryot-app/sandbox-sdk --filter @ryot-app/client-sdk --filter @ryot-app/client-ui-sdk --filter @ryot-app/plugin-kit --production --frozen-lockfile
RUN rm -rf /app/packages/client-plugin-compiler

FROM base AS runner
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*
COPY --from=backend-builder /app/kernel/sandboxd/dist /tmp/ryot-sandboxd
COPY kernel/sandboxd/tests/launcher/provision.sh /tmp/provision-sandboxd.sh
RUN bash /tmp/provision-sandboxd.sh \
    /tmp/ryot-sandboxd/ryot-sandbox-launcher \
    /tmp/ryot-sandboxd/ryot-sandboxd \
    /tmp/ryot-sandboxd/snapshots && \
    rm -rf /tmp/ryot-sandboxd /tmp/provision-sandboxd.sh
ENV FRONTEND_UMAMI_HOST_URL="https://umami.diptesh.me"
ENV FRONTEND_UMAMI_WEBSITE_ID="5ecd6915-d542-4fda-aa5f-70f09f04e2e0"
WORKDIR /home/ryot
RUN mkdir -p /home/ryot/logs /home/ryot/plugins /home/ryot/storage /home/ryot/tmp /home/ryot/work && \
    chown -R ryot-backend:ryot-backend /home/ryot/logs /home/ryot/plugins /home/ryot/storage /home/ryot/tmp /home/ryot/work
COPY --chown=ryot-backend:ryot-backend kernel/backend/src/drizzle ./src/drizzle
COPY --from=client-builder --chown=ryot-backend:ryot-backend /app/kernel/client/dist ./client
COPY --from=backend-builder --chown=ryot-backend:ryot-backend /app/apps/server/dist ./dist
COPY --from=backend-builder --chown=ryot-backend:ryot-backend /app/apps/server/plugins ./plugins
COPY --from=runtime-deps --chown=ryot-backend:ryot-backend /app/node_modules ./node_modules
COPY --from=runtime-deps --chown=ryot-backend:ryot-backend /app/packages ./packages
USER 1001:1001
RUN bun run dist/prepare-sandbox-runtime.js
ENV NODE_ENV=production
CMD ["bun", "run", "dist/main.js"]
