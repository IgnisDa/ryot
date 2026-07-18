# Contributing

:::info
Read the applicable `AGENTS.md` files before you change code.
:::

Prerequisites: [Bun](https://bun.sh) and [Docker](https://www.docker.com).

1. Install dependencies with `bun install`.
2. Start required services:

   ```bash
   bun run docker:up
   ```

3. Set these environment variables in `apps/server/.env`:

   ```txt
   REDIS_URL=redis://localhost:6379
   FILE_STORAGE_S3_BUCKET_NAME=ryot
   FRONTEND_URL=http://localhost:3005
   FILE_STORAGE_S3_URL=http://localhost:9000
   FILE_STORAGE_S3_ACCESS_KEY_ID=rustfsadmin
   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
   FILE_STORAGE_S3_SECRET_ACCESS_KEY=rustfsadmin
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ryot
   SERVER_ADMIN_ACCESS_TOKEN=super-secret-token-that-should-be-changed
   ```

4. Start development services with `bun turbo --filter=@ryot-app/server dev` and `bun turbo --filter=@ryot-app/kernel-client dev`.

The server task builds and watches the shipped plugin bundles. Use `bun run build`,
`bun run test`, and `bun run check` before you submit changes.

## Contributor License Agreement

External contributors must sign the
[Ryot Individual Contributor License Agreement](https://github.com/IgnisDa/ryot/blob/main/CLA.md)
before a pull request can be merged. CLA Assistant will request an electronic signature
on the pull request.

Only submit work that you have the right to contribute. Obtain any permission required
from your employer, and identify third-party material and its license in the pull request.
