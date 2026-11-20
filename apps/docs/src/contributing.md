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

PR Validation builds both Linux image architectures from the PR merge commit and checks all six
sandbox runtime keys. Full sandbox/backend tests run for backend, sandbox, server, package, plugin,
or shared build-input changes. Kubernetes acceptance runs for chart, deployment, or shared build-input
changes. Release tags require full validation.

To publish a preview of an open PR from this repository, wait for PR Validation to succeed, then run
**Publish PR Preview** from the default branch with the PR number. Pull the result as
`ghcr.io/ignisda/ryot-preview:pr-<number>`. The preview follows the validated merge commit. Use
**Main Publication** on the default branch to republish the current main image.

## Contributor License Agreement

External contributors must sign the
[Ryot Individual Contributor License Agreement](https://github.com/IgnisDa/ryot/blob/main/CLA.md)
before a pull request can be merged. CLA Assistant will request an electronic signature
on the pull request.

Only submit work that you have the right to contribute. Obtain any permission required
from your employer, and identify third-party material and its license in the pull request.
