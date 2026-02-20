ARG NODE_BASE_IMAGE=node:24.4.0-bookworm-slim

FROM $NODE_BASE_IMAGE AS frontend-build-base
WORKDIR /app
RUN apt update && apt install -y --no-install-recommends git curl ca-certificates xz-utils

FROM frontend-build-base AS frontend-pruner
WORKDIR /app
RUN npm install -g turbo
COPY . .
RUN turbo prune @ryot/frontend --docker

FROM frontend-build-base AS frontend-builder
WORKDIR /app
COPY --from=frontend-pruner /app/out/json/ .
RUN yarn install --immutable
COPY --from=frontend-pruner /app/out/full/ .
RUN yarn turbo run build --filter=@ryot/frontend

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
RUN apt-get update && apt-get install -y --no-install-recommends wget curl ca-certificates procps libc6 && rm -rf /var/lib/apt/lists/*
COPY --from=caddy:2.9.1 /usr/bin/caddy /usr/local/bin/caddy
RUN npm install --global concurrently@9.1.2 && concurrently --version
RUN useradd -m -u 1001 ryot
COPY ci/run-container.sh /usr/local/bin/run-container.sh
RUN chmod +x /usr/local/bin/run-container.sh
WORKDIR /home/ryot
USER ryot
COPY ci/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/frontend/node_modules ./node_modules
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/frontend/package.json ./package.json
COPY --from=frontend-builder --chown=ryot:ryot /app/apps/frontend/build ./build
COPY --from=artifact --chown=ryot:ryot /artifact/backend /usr/local/bin/backend
CMD ["/usr/local/bin/run-container.sh"]
