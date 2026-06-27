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
RUN bun run --filter @ryot/app-backend build
RUN mkdir -p /sandbox-install/apps/app-backend /sandbox-install/apps/app-client \
        /sandbox-install/libs/contract /sandbox-install/libs/query-engine \
        /sandbox-install/libs/sandbox-sdk /sandbox-install/libs/ts-utils && \
    cp package.json bun.lock /sandbox-install/ && \
    cp apps/app-backend/package.json /sandbox-install/apps/app-backend/ && \
    cp apps/app-client/package.json /sandbox-install/apps/app-client/ && \
    cp libs/contract/package.json /sandbox-install/libs/contract/ && \
    cp libs/query-engine/package.json /sandbox-install/libs/query-engine/ && \
    cp libs/sandbox-sdk/package.json /sandbox-install/libs/sandbox-sdk/ && \
    cp libs/ts-utils/package.json /sandbox-install/libs/ts-utils/ && \
    cp -R libs/sandbox-sdk/src /sandbox-install/libs/sandbox-sdk/src && \
    bun install --cwd /sandbox-install --filter @ryot/sandbox-sdk --production --frozen-lockfile --backend=copyfile --linker=hoisted --ignore-scripts && \
    cp -a /sandbox-install/node_modules /sandbox-compiler-runtime && \
    rm /sandbox-compiler-runtime/@ryot/sandbox-sdk && \
    cp -R /sandbox-install/libs/sandbox-sdk /sandbox-compiler-runtime/@ryot/sandbox-sdk && \
    cp -LR apps/app-backend/node_modules/typescript /sandbox-compiler-runtime/typescript && \
    cp -LR apps/app-backend/node_modules/typescript/../@typescript /sandbox-compiler-runtime/@typescript

FROM builder-base AS client-builder
RUN bun run --filter @ryot/app-client build

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
COPY --from=backend-builder --chown=ryot:ryot /app/apps/app-backend/dist ./dist
COPY --from=client-builder --chown=ryot:ryot /app/apps/app-client/dist ./client
COPY --from=backend-builder --chown=ryot:ryot /sandbox-compiler-runtime ./node_modules
RUN bun -e 'const from = "/home/ryot/dist"; if (!(await Bun.file(`${from}/compiler-worker.js`).exists())) throw new Error("Compiler worker is missing"); const sdk = Bun.resolveSync("@ryot/sandbox-sdk", from); const typescript = Bun.resolveSync("typescript/package.json", from); const typescriptDirectory = typescript.slice(0, typescript.lastIndexOf("/")); Bun.resolveSync("typescript/unstable/async", from); Bun.resolveSync(`@typescript/typescript-${process.platform}-${process.arch}/package.json`, typescriptDirectory); Bun.resolveSync("zod", sdk)'
RUN bun -e 'const worker = Bun.spawn([process.execPath, "--smol", "--no-orphans", "--no-install", "--no-env-file", "/home/ryot/dist/compiler-worker.js"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" }); await worker.stdin.end(); const [stdout, stderr, exitCode] = await Promise.all([new Response(worker.stdout).text(), new Response(worker.stderr).text(), worker.exited]); const response = JSON.parse(stdout); if (exitCode !== 0 || response.success !== false || response.error.diagnostics.some(({ code }) => code === "RYOT_COMPILER" || code === "RYOT_COMPILER_PROCESS")) throw new Error(`Compiler worker smoke failed: ${stderr || stdout}`)'
# Build the read-only sandbox dependency runtime so startup requires no registry access.
RUN POPULATE_SANDBOX_CACHE_ONLY=true bun run dist/main.js && \
    chown -R ryot:ryot /home/ryot/tmp
USER ryot
ENV NODE_ENV=production
CMD ["bun", "run", "dist/main.js"]
