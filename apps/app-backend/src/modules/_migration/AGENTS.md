# Migration Agent Notes

The purpose of this module is to migrate legacy V1 Rust data (apps/backend) into the V2
TypeScript backend (apps/app-backend) during startup.

## Boundaries

- Keep all migration-specific logic inside this module.
- `index.ts` must stay small and only re-export the startup entrypoints.
- Run the legacy table rename before Drizzle migrations.
- Run the legacy user data copy after Drizzle migrations have created the new tables.
- Prefer SQL for set-based work. Use TypeScript only for orchestration.

## Current Decisions

- V1 `user` is renamed to `old_user` so the new Drizzle `user` table can be created.
- Preserve legacy user ids.
- Derive new emails from the old user name as `name@ryot.local`, with normalization and a stable fallback for collisions.
- New users get `email_verified = true` because the legacy account was already trusted.

## Ignored For Now

- 2FA payloads.
- OIDC identities.
- Sessions.
- `extra_information`.
- `is_disabled`.
- Legacy admin `lot`.
- Any non-user V1 tables.

## Local Testing

1. Restore the prod dump into the local DB:

```bash
export PGHOST=localhost PGDATABASE=postgres PGPASSWORD=postgres PGUSER=postgres && dropdb "$PGDATABASE" --force && createdb "$PGDATABASE" && pg_restore --verbose -d "$PGDATABASE" < tmp/file.sql
```

2. Run the app backend:

```bash
bun turbo --filter=@ryot/app-backend dev 2>&1 | tee /tmp/ryot-app-backend-dev.log
```

3. Inspect the logs and verify the migrated rows via MCP against the same local DB.
