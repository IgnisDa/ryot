ARG NODE_BASE_IMAGE=node:24.4.0-bookworm-slim

FROM $NODE_BASE_IMAGE AS frontend-build-base
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

FROM --platform=${BUILDPLATFORM} alpine AS artifact
COPY artifact/ /artifact/
ARG TARGETARCH
ENV TARGETARCH=${TARGETARCH}
RUN mv /artifact/backend-${TARGETARCH}/backend /artifact/backend
RUN chmod +x /artifact/backend

FROM $NODE_BASE_IMAGE
ARG TARGETARCH
ENV TARGETARCH=${TARGETARCH}
LABEL org.opencontainers.image.source="https://github.com/IgnisDa/ryot"
LABEL org.opencontainers.image.description="The only self hosted tracker you will ever need!"
ENV FRONTEND_UMAMI_SCRIPT_URL="https://umami.diptesh.me/script.js"
ENV FRONTEND_UMAMI_WEBSITE_ID="5ecd6915-d542-4fda-aa5f-70f09f04e2e0"
ENV RUST_MIN_STACK=8388608
RUN apt-get update && apt-get install -y --no-install-recommends wget curl ca-certificates procps libc6 && rm -rf /var/lib/apt/lists/*
COPY --from=caddy:2.9.1 /usr/bin/caddy /usr/local/bin/caddy
RUN npm install --global concurrently@9.1.2 && concurrently --version
RUN useradd -m -u 1001 ryot
WORKDIR /home/ryot
USER ryot
COPY ci/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/frontend/node_modules ./node_modules
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/frontend/package.json ./package.json
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/frontend/build ./build
COPY --from=artifact --chown=ryot:ryot /artifact/backend /usr/local/bin/backend
CMD [ \
    "concurrently", "--names", "frontend,backend,proxy", "--kill-others", \
    "PORT=3000 npx react-router-serve ./build/server/index.js", \
    "BACKEND_PORT=5000 /usr/local/bin/backend", \
    "caddy run --config /etc/caddy/Caddyfile" \
    ]
