# Contributing

:::info
Read the applicable `AGENTS.md` files before you change code.
:::

Prerequisites: [Bun](https://bun.sh) and [Docker](https://www.docker.com).

1. Install dependencies with `bun install`.
2. Start PostgreSQL and Redis:

   ```bash
   docker compose up -d ryot-postgres ryot-redis
   ```

3. Set `DATABASE_URL`, `REDIS_URL`, and `SERVER_ADMIN_ACCESS_TOKEN` in `apps/server/.env`.
4. Start development services with `bun run dev`.

The server task builds and watches the shipped plugin bundles. Use `bun run build`,
`bun run test`, and `bun run check` before you submit changes.
