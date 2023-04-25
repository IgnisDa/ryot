FROM node:19.8.1 AS base
WORKDIR /app
RUN npm install -g @moonrepo/cli

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

FROM alpine as tini-builder
ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini-static /tini
RUN chmod +x /tini

FROM lukemathwalker/cargo-chef:latest-rust-1 AS chef
ENV USER=app-runner
ENV UID=10001
RUN adduser \
    --disabled-password \
    --gecos "" \
    --home "/nonexistent" \
    --shell "/sbin/nologin" \
    --no-create-home \
    --uid "${UID}" \
    "${USER}"
RUN apt-get update && apt-get install -y musl-tools musl-dev
RUN rustup target add x86_64-unknown-linux-musl
RUN update-ca-certificates
WORKDIR app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS app-builder 
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY . .
COPY --from=frontend-builder /app/apps/frontend/out ./apps/frontend/out
RUN cargo build --release --bin trackona_backend --target x86_64-unknown-linux-musl

FROM scratch
COPY --from=chef /etc/passwd /etc/passwd
COPY --from=chef /etc/group /etc/group
COPY --from=tini-builder --chown=app-runner:app-runner /tini /tini
COPY --from=app-builder --chown=app-runner:app-runner /app/target/x86_64-unknown-linux-musl/release/trackona_backend /app
USER app-runner:app-runner
ENTRYPOINT ["/tini", "--", "/app"]
