FROM rust:1.93.1-bookworm AS rust-toolchain

FROM ryot-sandbox-backend-builder-base

COPY --from=rust-toolchain /usr/local/cargo /usr/local/cargo
COPY --from=rust-toolchain /usr/local/rustup /usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo
ENV CARGO_BUILD_JOBS=1
ENV RUSTUP_HOME=/usr/local/rustup
ENV PATH=/usr/local/cargo/bin:$PATH

USER root
RUN apt-get update && apt-get install -y --no-install-recommends build-essential ca-certificates python3 && \
    rm -rf /var/lib/apt/lists/*
RUN bun turbo --filter=@ryot-app/sandboxd build --concurrency=1 --env-mode=loose
RUN bash /app/kernel/sandboxd/provision.sh \
    /app/kernel/sandboxd/dist/ryot-sandbox-launcher \
    /app/kernel/sandboxd/dist/ryot-sandboxd \
    /app/kernel/sandboxd/dist/snapshots && \
    chown -R 1001:1001 /app

USER 1001:1001
WORKDIR /app/kernel/backend
CMD ["bun", "--bun", "run", "vitest", "run", "src/lib/infrastructure/sandbox-runtime/short-wait.test.ts", "src/lib/infrastructure/sandbox-runtime/host-call-gate.test.ts", "src/lib/infrastructure/sandbox-runtime/durable-host-dispatcher.test.ts", "src/lib/infrastructure/sandbox-runtime/short-wait-native.test.ts", "src/lib/infrastructure/sandbox-runtime/sidecar-supervisor.test.ts", "src/lib/infrastructure/provider-http-admission.test.ts", "src/modules/sandbox/durable-queues.test.ts", "src/modules/sandbox/sandbox-script-workflow-checkpoint.test.ts", "src/modules/sandbox/durable-queue-lanes.test.ts"]
