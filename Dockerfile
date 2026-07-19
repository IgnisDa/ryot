FROM oven/bun:1.3.14-debian AS base
WORKDIR /app

FROM base AS prepare
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --global turbo@2.9.16
COPY . .
RUN turbo prune @ryot/app-client @ryot/app-backend --docker

FROM base AS builder-base
COPY --from=prepare /app/out/json/ .
# Force Bun's copyfile backend because the default Linux hardlink backend is flaky
# under Docker BuildKit for some tarballs (for example, expo-modules-core).
# Keep --ignore-scripts because removing it makes the backend build fail while
# resolving msgpackr-extract during the Bun bundle step.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --backend=copyfile --ignore-scripts
COPY --from=prepare /app/out/full/ .
COPY --from=prepare /app/tsconfig.options.json ./tsconfig.options.json

FROM builder-base AS backend-builder
RUN bun turbo --filter=@ryot/app-backend build

FROM builder-base AS client-builder
RUN bun turbo --filter=@ryot/app-client build

FROM base AS sandbox-compiler-runtime
COPY --from=prepare /app/out/json/ .
COPY --from=prepare /app/out/full/packages/sandbox-compiler ./packages/sandbox-compiler
COPY --from=prepare /app/out/full/packages/sandbox-sdk ./packages/sandbox-sdk
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --filter @ryot/sandbox-compiler --production --frozen-lockfile \
    --backend=copyfile --linker=hoisted --ignore-scripts

FROM base AS runner
RUN useradd -m -u 1001 ryot
ARG TARGETARCH
ARG DENO_VERSION=2.8.1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip && \
    DENO_ARCH="${TARGETARCH:-$(dpkg --print-architecture)}" && \
    case "$DENO_ARCH" in \
      amd64) DENO_TARGET=x86_64-unknown-linux-gnu; DENO_SHA256=2d7bb6195226ac832e0bf7109a115f0af65ee69ac797a4bbde5b27a06cc242d9 ;; \
      arm64) DENO_TARGET=aarch64-unknown-linux-gnu; DENO_SHA256=67e9df91870fd0af700df924173e3009ea7ff6956e2c3c3bb86065d6070d0fd6 ;; \
      *) echo "Unsupported architecture: $DENO_ARCH" >&2; exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-${DENO_TARGET}.zip" -o /tmp/deno.zip && \
    echo "${DENO_SHA256}  /tmp/deno.zip" | sha256sum -c - && \
    unzip -q /tmp/deno.zip -d /tmp && \
    install -m 0755 /tmp/deno /usr/local/bin/deno && \
    rm -f /tmp/deno /tmp/deno.zip && \
    apt-get remove -y curl unzip && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*
ENV SANDBOX_DENO_DIR=/home/ryot/tmp
WORKDIR /home/ryot
COPY --chown=ryot:ryot apps/app-backend/src/drizzle ./src/drizzle
COPY --chown=ryot:ryot apps/app-backend/src/modules/definition-registry/kernel-scripts /src/modules/definition-registry/kernel-scripts
COPY --chown=ryot:ryot plugins /plugins
COPY --from=client-builder --chown=ryot:ryot /app/apps/app-client/dist ./client
COPY --from=backend-builder --chown=ryot:ryot /app/apps/app-backend/dist ./dist
COPY --from=backend-builder --chown=ryot:ryot /app/packages/sandbox-compiler/dist/compiler-worker.js* ./dist/
COPY --from=sandbox-compiler-runtime --chown=ryot:ryot /app/node_modules ./node_modules
COPY --from=sandbox-compiler-runtime --chown=ryot:ryot /app/packages ./packages
USER ryot
RUN bun run dist/smoke-compiler-worker.js /home/ryot/dist/compiler-worker.js
# Build the read-only sandbox dependency runtime so startup requires no registry access.
RUN bun run dist/prepare-sandbox-runtime.js
ENV NODE_ENV=production
CMD ["bun", "run", "dist/main.js"]
