ARG NODE_BASE_IMAGE=node:20.5.1-bookworm-slim
FROM --platform=$BUILDPLATFORM $NODE_BASE_IMAGE AS node-build-base

FROM node-build-base AS build-base
ENV MOON_TOOLCHAIN_FORCE_GLOBALS=true
WORKDIR /app
RUN apt update && apt install -y --no-install-recommends git curl ca-certificates xz-utils
RUN npm install -g @moonrepo/cli && moon --version

FROM build-base AS frontend-workspace
WORKDIR /app
COPY . .
RUN moon docker scaffold frontend

FROM build-base AS frontend-builder
WORKDIR /app
COPY --from=frontend-workspace /app/.moon/docker/workspace .
RUN moon docker setup
COPY --from=frontend-workspace /app/.moon/docker/sources .
RUN moon run frontend:build

FROM --platform=$BUILDPLATFORM lukemathwalker/cargo-chef AS chef
RUN apt-get update && apt-get install -y --no-install-recommends gcc-aarch64-linux-gnu libc6-dev-arm64-cross clang llvm ca-certificates
RUN update-ca-certificates
WORKDIR app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS app-builder
ARG TARGETARCH
ARG BUILD_PROFILE=release
ENV RUST_TARGET_TRIPLE_arm64="aarch64-unknown-linux-gnu"
ENV RUST_TARGET_TRIPLE_amd64="x86_64-unknown-linux-gnu"
ENV TARGET_CC="clang"
ENV TARGET_AR="llvm-ar"
ENV CFLAGS_aarch64_unknown_linux_gnu="--sysroot=/usr/aarch64-linux-gnu"
ENV CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc
COPY --from=planner /app/recipe.json recipe.json
RUN rustup target add $(eval "echo \$RUST_TARGET_TRIPLE_$TARGETARCH")
RUN cargo chef cook --profile $BUILD_PROFILE --target $(eval "echo \$RUST_TARGET_TRIPLE_$TARGETARCH") --recipe-path recipe.json
COPY . .
RUN ./apps/backend/ci/build-app.sh

FROM caddy:2.7.5 as reverse-proxy

FROM $NODE_BASE_IMAGE
RUN apt-get update && apt-get install -y --no-install-recommends curl supervisor ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1001 ryot
WORKDIR /home/ryot
USER ryot
COPY config/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY config/Caddyfile /etc/caddy/Caddyfile
COPY --from=reverse-proxy /usr/bin/caddy /usr/local/bin/caddy
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/frontend/node_modules ./node_modules
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/frontend/package.json ./package.json
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/frontend/build ./build
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/frontend/public ./public
COPY --from=app-builder --chown=ryot:ryot /app/ryot /usr/local/bin/ryot
HEALTHCHECK --interval=5m --timeout=3s \
  CMD curl -f http://localhost:5000/config || exit 1
CMD [ "/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf" ]
