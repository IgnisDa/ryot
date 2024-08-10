ARG NODE_BASE_IMAGE=node:20.10.0-bookworm-slim

FROM $NODE_BASE_IMAGE AS frontend-build-base
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

FROM --platform=${BUILDPLATFORM} alpine as artifact
COPY artifact/ /artifact/
ARG TARGETARCH
ENV TARGETARCH=${TARGETARCH}
RUN mv /artifact/backend-${TARGETARCH}/ryot /artifact/ryot
RUN chmod +x /artifact/ryot

FROM $NODE_BASE_IMAGE
ARG TARGETARCH
ENV TARGETARCH=${TARGETARCH}
LABEL org.opencontainers.image.source="https://github.com/IgnisDa/ryot"
ENV FRONTEND_UMAMI_SCRIPT_URL="https://umami.diptesh.me/script.js"
ENV FRONTEND_UMAMI_WEBSITE_ID="5ecd6915-d542-4fda-aa5f-70f09f04e2e0"
COPY --from=caddy:2.7.5 /usr/bin/caddy /usr/local/bin/caddy
RUN apt-get update && apt-get install -y --no-install-recommends libssl3 ca-certificates procps && rm -rf /var/lib/apt/lists/*
RUN npm install --global concurrently@8.2.2 && concurrently --version
RUN useradd -m -u 1001 ryot
RUN if [ "${TARGETARCH}" = "arm64" ]; then apt-get update && apt-get install -y --no-install-recommends wget && wget http://ftp.debian.org/debian/pool/main/o/openssl/libssl1.1_1.1.1w-0+deb11u1_arm64.deb && dpkg -i libssl1.1_1.1.1w-0+deb11u1_arm64.deb && rm -rf libssl1.1_1.1.1w-0+deb11u1_arm64.deb && apt-get remove -y wget && rm -rf  rm -rf /var/lib/apt/lists/*; fi
WORKDIR /home/ryot
USER ryot
COPY ci/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/frontend/node_modules ./node_modules
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/frontend/package.json ./package.json
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/frontend/build ./build
COPY --from=artifact --chown=ryot:ryot /artifact/ryot /usr/local/bin/ryot
CMD [ \
    "concurrently", "--names", "frontend,backend,proxy", "--kill-others", \
    "PORT=3000 npx remix-serve ./build/server/index.js", \
    "BACKEND_PORT=5000 /usr/local/bin/ryot", \
    "caddy run --config /etc/caddy/Caddyfile" \
]
