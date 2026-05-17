# Legacy Bootstrap Agent Notes

The purpose of this module is to migrate legacy V1 Rust data (`apps/backend`) into the V2
TypeScript backend (`apps/app-backend`) during startup.

## Boundaries

- Keep all legacy bootstrap-specific logic inside this module.
- `index.ts` must stay small and only re-export the startup entrypoints.
- Run the legacy table rename before Drizzle migrations.
- Run the legacy table data copy after Drizzle migrations have created the new tables.
- Prefer SQL for set-based work. Use TypeScript only for orchestration.

## Current Decisions

- V1 `user` is renamed to `old_user` so the new Drizzle `user` table can be created.
- Preserve legacy ids.
- Derive new emails from the old user name as `name@ryot.local`, with normalization and a stable fallback for collisions.
- New users get `email_verified = true` because the legacy account was already trusted.

## Ignored For Now

- OAuth redirect URL (V1 used `{frontend_url}/api/auth`; V2 uses Better Auth's default `/api/auth/oauth2/callback/oidc`).
- Sessions.
- `USERS_TOKEN_VALID_FOR_DAYS`: intentionally not ported into the V2 auth stack. Better Auth owns session lifetime separately; legacy bootstrap must not emulate the V1 token-duration knob.
- `extra_information`.
- `is_disabled`.
- Legacy admin `lot`.
- 2FA payloads: reason is that the data contained in the old schema is not enough to construct valid better 2FA credentials. This means that after the migration, all users will have 2FA disabled and will need to set it up again. This is a known limitation, but given the complexity of the migration and the fact that 2FA can be easily re-enabled by users, we have decided to proceed with this approach for now.
- OIDC identities: similar reasoning to 2FA. The old schema does not contain enough information to construct valid OIDC credentials, so all users will have OIDC disabled after the migration and will need to set it up again if they wish to use it.

## Local Testing

1. Restore the prod dump into the local DB:

```bash
export PGHOST=localhost PGDATABASE=postgres PGPASSWORD=postgres PGUSER=postgres && dropdb "$PGDATABASE" --force && createdb "$PGDATABASE" && pg_restore --verbose -d "$PGDATABASE" < /tmp/file.sql
```

2. Run the app backend:

```bash
bun turbo --filter=@ryot/app-backend dev 2>&1 | tee /tmp/ryot-app-backend-dev.log
```

3. Inspect the logs and verify the migrated rows via MCP against the same local DB.

4. You may create another database in the running Postgres instance, restore the dump into it, and inspect it with `psql`. MCP will not have access to that newly created database.
