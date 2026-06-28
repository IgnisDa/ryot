FROM oven/bun:1.3.14-debian AS base
WORKDIR /app

FROM base AS prepare
RUN bun install --global turbo@2.9.16
COPY . .
RUN turbo prune @ryot/app-client @ryot/app-backend --docker

FROM base AS builder-base
COPY --from=prepare /app/out/json/ .
# Force Bun's copyfile backend because the default Linux hardlink backend is flaky
# under Docker BuildKit for some tarballs (for example, expo-modules-core).
# Keep --ignore-scripts because removing it makes the backend build fail while
# resolving msgpackr-extract during the Bun bundle step.
RUN bun install --backend=copyfile --ignore-scripts
COPY --from=prepare /app/out/full/ .
COPY --from=prepare /app/tsconfig.options.json ./tsconfig.options.json

FROM builder-base AS backend-builder
RUN bun turbo --filter=@ryot/app-backend build

FROM builder-base AS client-builder
RUN bun turbo --filter=@ryot/app-client build

FROM base AS sandbox-compiler-runtime
COPY --from=prepare /app/out/json/ .
COPY --from=prepare /app/out/full/libs/sandbox-compiler ./libs/sandbox-compiler
COPY --from=prepare /app/out/full/libs/sandbox-sdk ./libs/sandbox-sdk
RUN bun install --filter @ryot/sandbox-compiler --production --frozen-lockfile \
    --backend=copyfile --linker=hoisted --ignore-scripts

FROM base AS runner
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
COPY --from=client-builder --chown=ryot:ryot /app/apps/app-client/dist ./client
COPY --from=backend-builder --chown=ryot:ryot /app/apps/app-backend/dist ./dist
COPY --from=backend-builder --chown=ryot:ryot /app/libs/sandbox-compiler/dist/compiler-worker.js* ./dist/
COPY --from=sandbox-compiler-runtime --chown=ryot:ryot /app/node_modules ./node_modules
COPY --from=sandbox-compiler-runtime --chown=ryot:ryot /app/libs ./libs
RUN bun -e 'const worker = Bun.spawn([process.execPath, "--smol", "--no-orphans", "--no-install", "--no-env-file", "/home/ryot/dist/compiler-worker.js"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" }); await worker.stdin.end(); const [stdout, stderr, exitCode] = await Promise.all([new Response(worker.stdout).text(), new Response(worker.stderr).text(), worker.exited]); const response = JSON.parse(stdout); if (exitCode !== 0 || response.success !== false || response.error.diagnostics.some(({ code }) => code === "RYOT_COMPILER" || code === "RYOT_COMPILER_PROCESS")) throw new Error(`Compiler worker smoke failed: ${stderr || stdout}`)'
# Build the read-only sandbox dependency runtime so startup requires no registry access.
RUN PREPARE_SANDBOX_RUNTIME_ONLY=true bun run dist/main.js && \
    chown -R ryot:ryot /home/ryot/tmp
USER ryot
ENV NODE_ENV=production
CMD ["bun", "run", "dist/main.js"]
