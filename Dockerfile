ARG NODE_BASE_IMAGE=node:20.10.0-bookworm-slim

FROM --platform=$BUILDPLATFORM $NODE_BASE_IMAGE AS node-build-base

FROM node-build-base AS frontend-build-base
ENV MOON_TOOLCHAIN_FORCE_GLOBALS=true
WORKDIR /app
RUN apt update && apt install -y --no-install-recommends git curl ca-certificates xz-utils
RUN npm install -g @moonrepo/cli && moon --version

FROM frontend-build-base AS frontend-workspace
WORKDIR /app
COPY . .
RUN moon docker scaffold frontend

FROM frontend-build-base AS frontend-builder
WORKDIR /app
COPY --from=frontend-workspace /app/.moon/docker/workspace .
RUN moon docker setup
COPY --from=frontend-workspace /app/.moon/docker/sources .
RUN moon run frontend:build
RUN moon docker prune

FROM --platform=$BUILDPLATFORM lukemathwalker/cargo-chef AS backend-chef
RUN apt-get update && apt-get install -y --no-install-recommends gcc-aarch64-linux-gnu libc6-dev-arm64-cross clang llvm ca-certificates
RUN update-ca-certificates
WORKDIR app

FROM backend-chef AS backend-planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM backend-chef AS backend-builder
ARG TARGETARCH
ENV RUST_TARGET_TRIPLE_arm64="aarch64-unknown-linux-gnu"
ENV RUST_TARGET_TRIPLE_amd64="x86_64-unknown-linux-gnu"
ENV TARGET_CC="clang"
ENV TARGET_AR="llvm-ar"
ENV CFLAGS_aarch64_unknown_linux_gnu="--sysroot=/usr/aarch64-linux-gnu"
ENV CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc
COPY --from=backend-planner /app/recipe.json recipe.json
RUN rustup target add $(eval "echo \$RUST_TARGET_TRIPLE_$TARGETARCH")
RUN cargo chef cook --profile dist --target $(eval "echo \$RUST_TARGET_TRIPLE_$TARGETARCH") --recipe-path recipe.json
COPY . .
RUN ./apps/backend/ci/build-app.sh

FROM $NODE_BASE_IMAGE
COPY --from=caddy:2.7.5 /usr/bin/caddy /usr/local/bin/caddy
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global concurrently@8.2.2 && concurrently --version
RUN useradd -m -u 1001 ryot
WORKDIR /home/ryot
USER ryot
COPY config/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/frontend/node_modules ./node_modules
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/frontend/package.json ./package.json
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/frontend/build ./build
COPY --from=backend-builder --chown=ryot:ryot /app/ryot /usr/local/bin/ryot
HEALTHCHECK --interval=5m --timeout=3s \
  CMD curl -f http://localhost:5000/config || exit 1
CMD [ \
    "concurrently", "--names", "frontend,backend,proxy", "--kill-others", \
    "PORT=3000 npx remix-serve ./build/server/index.js", \
    "BACKEND_PORT=5000 /usr/local/bin/ryot", \
    "caddy run --config /etc/caddy/Caddyfile" \
]
