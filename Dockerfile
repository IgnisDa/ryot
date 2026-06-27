FROM oven/bun:1.3.14-debian AS base
WORKDIR /app

FROM base AS prepare
RUN bun install --global turbo@2.9.16
COPY . .
RUN turbo prune @ryot/app-client @ryot/app-backend --docker

FROM base AS builder
COPY --from=prepare /app/out/json/ .
# Force Bun's copyfile backend because the default Linux hardlink backend is flaky
# under Docker BuildKit for some tarballs (for example, expo-modules-core).
# Keep --ignore-scripts because removing it makes the backend build fail while
# resolving msgpackr-extract during the Bun bundle step.
RUN bun install --backend=copyfile --ignore-scripts
COPY --from=prepare /app/out/full/ .
COPY --from=prepare /app/tsconfig.options.json ./tsconfig.options.json
RUN bun run --filter @ryot/app-client build
RUN bun run --filter @ryot/app-backend build
RUN mkdir -p sandbox-compiler-runtime/@ryot && \
    cp -LR apps/app-backend/node_modules/@ryot/sandbox-sdk sandbox-compiler-runtime/@ryot/sandbox-sdk && \
    cp -LR apps/app-backend/node_modules/typescript-compiler sandbox-compiler-runtime/typescript-compiler

FROM oven/bun:1.3.14-debian AS runner
RUN useradd -m -u 1001 ryot
RUN apt-get update && apt-get install -y curl unzip && \
    curl -fsSL https://deno.land/install.sh | sh -s -- --yes v2.8.1 && \
    mv /root/.deno/bin/deno /usr/local/bin/deno && \
    apt-get remove -y curl unzip && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*
ENV SANDBOX_DENO_DIR=/home/ryot/tmp
WORKDIR /home/ryot
COPY --chown=ryot:ryot apps/app-backend/src/drizzle ./src/drizzle
COPY --from=builder --chown=ryot:ryot /app/apps/app-backend/dist ./dist
COPY --from=builder --chown=ryot:ryot /app/apps/app-client/dist ./client
COPY --from=builder --chown=ryot:ryot /app/sandbox-compiler-runtime ./node_modules
RUN bun -e 'const from = "/home/ryot/dist"; const sdk = Bun.resolveSync("@ryot/sandbox-sdk", from); Bun.resolveSync("typescript-compiler", from); Bun.resolveSync("zod", sdk)'
# Pre-populate the Deno package cache at build time so startup requires no network access.
RUN POPULATE_SANDBOX_CACHE_ONLY=true bun run dist/main.js && \
    chown -R ryot:ryot /home/ryot/tmp
USER ryot
ENV NODE_ENV=production
CMD ["bun", "run", "dist/main.js"]
