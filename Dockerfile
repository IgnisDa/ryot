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
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
RUN chmod +x /tini

FROM lukemathwalker/cargo-chef:latest-rust-1 AS chef
RUN apt-get update && apt-get -y install curl
WORKDIR app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS app-builder 
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY . .
COPY --from=frontend-builder /app/apps/frontend/out ./apps/frontend/out
RUN cargo build --release --bin trackona_backend

FROM gcr.io/distroless/cc:latest
ENV TINI_SUBREAPER="1"
COPY --from=tini-builder /tini /tini
COPY --from=app-builder /app/target/release/trackona_backend /app
ENTRYPOINT ["/tini", "--", "/app"]
