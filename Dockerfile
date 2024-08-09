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
RUN moon docker scaffold frontend transactional

FROM frontend-build-base AS frontend-builder
WORKDIR /app
COPY --from=frontend-workspace /app/.moon/docker/workspace .
RUN moon docker setup
COPY --from=frontend-workspace /app/.moon/docker/sources .
RUN moon run frontend:build transactional:build
RUN moon docker prune

FROM --platform=$BUILDPLATFORM lukemathwalker/cargo-chef AS backend-chef
RUN apt-get update && apt-get install -y --no-install-recommends gcc-aarch64-linux-gnu libc6-dev-arm64-cross clang llvm ca-certificates pkg-config make g++ libssl-dev
RUN update-ca-certificates
WORKDIR app

FROM backend-chef AS backend-planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM backend-chef AS backend-builder
# build specific
ARG BUILD_PROFILE=release
# application specific
ARG APP_VERSION
ARG DEFAULT_TMDB_ACCESS_TOKEN
ARG DEFAULT_MAL_CLIENT_ID
ARG DEFAULT_GOOGLE_BOOKS_API_KEY
RUN test -n "$APP_VERSION" && \
    test -n "$DEFAULT_TMDB_ACCESS_TOKEN" && \
    test -n "$DEFAULT_MAL_CLIENT_ID" && \
    test -n "$DEFAULT_GOOGLE_BOOKS_API_KEY"
COPY --from=backend-planner /app/recipe.json recipe.json
RUN cargo chef cook --profile $BUILD_PROFILE --recipe-path recipe.json
COPY . .
COPY --from=frontend-builder /app/apps/backend/templates ./apps/backend/templates
RUN APP_VERSION=$APP_VERSION \
    DEFAULT_TMDB_ACCESS_TOKEN=$DEFAULT_TMDB_ACCESS_TOKEN \
    DEFAULT_MAL_CLIENT_ID=$DEFAULT_MAL_CLIENT_ID \
    DEFAULT_GOOGLE_BOOKS_API_KEY=$DEFAULT_GOOGLE_BOOKS_API_KEY \
    cargo build --profile ${BUILD_PROFILE} --bin ryot
RUN cp -R /app/target/${BUILD_PROFILE}/ryot /app/ryot

FROM $NODE_BASE_IMAGE
LABEL org.opencontainers.image.source="https://github.com/IgnisDa/ryot"
ENV FRONTEND_UMAMI_SCRIPT_URL="https://umami.diptesh.me/script.js"
ENV FRONTEND_UMAMI_WEBSITE_ID="5ecd6915-d542-4fda-aa5f-70f09f04e2e0"
COPY --from=caddy:2.7.5 /usr/bin/caddy /usr/local/bin/caddy
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates procps && rm -rf /var/lib/apt/lists/*
RUN npm install --global concurrently@8.2.2 && concurrently --version
RUN useradd -m -u 1001 ryot
WORKDIR /home/ryot
USER ryot
COPY ci/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/frontend/node_modules ./node_modules
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/frontend/package.json ./package.json
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/frontend/build ./build
COPY --from=backend-builder --chown=ryot:ryot /app/ryot /usr/local/bin/ryot
CMD [ \
    "concurrently", "--names", "frontend,backend,proxy", "--kill-others", \
    "PORT=3000 npx remix-serve ./build/server/index.js", \
    "BACKEND_PORT=5000 /usr/local/bin/ryot", \
    "caddy run --config /etc/caddy/Caddyfile" \
]
