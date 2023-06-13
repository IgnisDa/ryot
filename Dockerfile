FROM --platform=$BUILDPLATFORM node:19.8.1 AS base
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

FROM --platform=$BUILDPLATFORM lukemathwalker/cargo-chef:latest-rust-1 AS chef
RUN apt-get update && apt-get install -y --no-install-recommends musl-tools musl-dev ca-certificates clang llvm gcc-multilib
RUN update-ca-certificates
WORKDIR app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS app-builder 
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --profile dist --recipe-path recipe.json
COPY . .
COPY --from=frontend-builder /app/apps/frontend/out ./apps/frontend/out
ARG TARGETARCH
RUN ./build-app.sh

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
COPY apps/backend/CHECKS ./CHECKS
ENTRYPOINT ["/app"]
