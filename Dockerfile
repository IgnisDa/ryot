FROM --platform=$BUILDPLATFORM node:latest AS base
WORKDIR /app
RUN npm install -g @moonrepo/cli && moon --version

FROM base AS frontend-workspace
WORKDIR /app
COPY . .
RUN moon docker scaffold frontend

FROM base AS frontend-builder
WORKDIR /app
COPY --from=frontend-workspace /app/.moon/docker/workspace .
RUN moon docker setup
COPY --from=frontend-workspace /app/.moon/docker/sources .
RUN moon run frontend:build

FROM --platform=$BUILDPLATFORM lukemathwalker/cargo-chef:0.1.61-rust-1.70.0 AS chef
RUN apt-get update && apt-get install -y --no-install-recommends musl-tools musl-dev clang llvm ca-certificates
RUN update-ca-certificates
WORKDIR app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS app-builder 
ARG TARGETARCH
ENV RUST_TARGET_TRIPLE_arm64="aarch64-unknown-linux-musl"
ENV RUST_TARGET_TRIPLE_amd64="x86_64-unknown-linux-musl"
ENV CC_aarch64_unknown_linux_musl="clang"
ENV AR_aarch64_unknown_linux_musl="llvm-ar"
ENV CFLAGS_aarch64_unknown_linux_musl="-nostdinc -nostdlib -isystem/usr/include/x86_64-linux-musl/"
ENV CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_RUSTFLAGS="-Clink-self-contained=yes -Clinker=rust-lld -Clink-args=-L/usr/lib/x86_64-linux-musl/"
COPY --from=planner /app/recipe.json recipe.json 
RUN rustup target add $(eval "echo \$RUST_TARGET_TRIPLE_$TARGETARCH")
RUN cargo chef cook --profile dist --target $(eval "echo \$RUST_TARGET_TRIPLE_$TARGETARCH") --recipe-path recipe.json
COPY . .
COPY --from=frontend-builder /app/apps/frontend/out ./apps/frontend/out
RUN ./apps/backend/ci/build-app.sh

# taken from https://medium.com/@lizrice/non-privileged-containers-based-on-the-scratch-image-a80105d6d341
FROM ubuntu:latest as user-creator
RUN useradd -u 1001 ryot

FROM scratch
COPY --from=chef /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=user-creator /etc/passwd /etc/passwd
USER ryot
# This is actually a hack to ensure that the `/data` directory exists in the image
# since we can not use `RUN` directly (there is no shell to execute it).
WORKDIR /data
COPY --from=app-builder --chown=ryot:ryot /app/ryot /app
COPY apps/backend/ci/app.json ./app.json
ENTRYPOINT ["/app"]
