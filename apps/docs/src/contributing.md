# Contributing

:::info
Read the applicable `AGENTS.md` files before you change code.
:::

Prerequisites: [Bun](https://bun.sh), [Rust](https://rustup.rs) (the toolchain pinned in `kernel/sandbox/native/rust-toolchain.toml`), and [Docker](https://www.docker.com).

1. Install dependencies with `bun install`.
2. Start required services:

   ```bash
   bun run docker:up
   ```

The services create the `postgres` database and initialize the local `ryot` object-storage bucket.

3. Set these environment variables in `apps/server/.env`:

   ```txt
   FILE_STORAGE_S3_BUCKET_NAME=ryot
   FRONTEND_URL=http://localhost:3005
   FILE_STORAGE_S3_URL=http://localhost:9000
   FILE_STORAGE_S3_ACCESS_KEY_ID=rustfsadmin
   FILE_STORAGE_S3_SECRET_ACCESS_KEY=rustfsadmin
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
   SERVER_ADMIN_ACCESS_TOKEN=super-secret-token-that-should-be-changed
   ```

4. Start development services with `bun turbo --filter=@ryot-app/server dev` and `bun turbo --filter=@ryot-app/kernel-client dev`.

For optional traces and metrics, start `docker compose -f ci/dev/docker-compose.yml --profile
observability up -d` and set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` in the server's
`.env`. Leave that setting unset when the collector is not running.

The server task builds and watches the shipped plugin bundles. Follow the validation commands in `AGENTS.md` before submitting changes.

## CI and PR images

The Main workflow automatically builds both Linux image architectures, checks all six sandbox
runtime keys, and runs Helm lint/render/unit checks on relevant PRs and main pushes. Full
sandbox/backend tests run for backend, sandbox, server, package, plugin, or shared build-input
changes. Kubernetes install, persistence, and upgrade acceptance runs for chart, deployment,
or shared build-input changes. PR selection covers the entire PR; unavailable or truncated
change lists run full validation. Release tags always require all validation before publication.

To publish an open PR from this repository, manually run Main with its `pr-number`. This
publishes `pr-<number>` images after builds and smoke checks. Select `full-validation` to also
run the full tests and Kubernetes acceptance. Leaving the PR number empty publishes main
with the same validation options. Automatic PR runs never publish images.

## Contributor License Agreement

External contributors must sign the
[Ryot Individual Contributor License Agreement](https://github.com/IgnisDa/ryot/blob/main/CLA.md)
before a pull request can be merged. CLA Assistant will request an electronic signature
on the pull request.

Only submit work that you have the right to contribute. Obtain any permission required
from your employer, and identify third-party material and its license in the pull request.
