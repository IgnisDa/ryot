# Legacy Bootstrap Agent Notes

This is a living document and must be kept up to date as the module evolves.

The purpose of this module is to migrate legacy V1 Rust data (`apps/backend`) into the V2
TypeScript backend (`apps/app-backend`) during startup.

## Fail-Fast Requirement

Every step in this module must fail loudly on unexpected state. Use `throw new Error(...)` in TypeScript and `RAISE EXCEPTION '...'` in PL/pgSQL DO blocks — never `RETURN` from a DO block when the missing object signals an error rather than an already-completed step.

Permitted silent-skip patterns: idempotent guards (work already done on a previous startup), `ON CONFLICT … DO NOTHING` on all inserts (restart-safety), `DROP TABLE IF EXISTS` in `drop-tables.ts` (restart-safety), `shouldRunLegacyBootstrap` returning `false` (main gate — no V1 data present), and the intentional data-level skips listed in "Ignored For Now" below. Everything else must throw.

## Boundaries

- Keep all legacy bootstrap-specific logic inside this module.
- `index.ts` must stay small and only re-export the startup entrypoints.
- Do not add automated tests inside this module; validate changes by restoring the legacy dump, running `bun run run-migration`, and inspecting the migrated rows via MCP.
- Do not edit `src/lib/db/migrate.ts` unless the change has been discussed first.
- Run the legacy table rename before Drizzle migrations.
- Run the legacy table data copy after Drizzle migrations have created the new tables.
- Prefer SQL for set-based work. Use TypeScript only for orchestration.
- **Never hardcode `public.` as a schema prefix in SQL statements.** The V1 backend (SeaORM) used bare table names that resolve through PostgreSQL's `search_path`, so V1 tables may live in a non-public schema. Use quoted bare table names (e.g., `"old_user"`, `"metadata"`) instead of `public.table_name` to resolve correctly regardless of schema. See #1372.
- SQL value lists inlined into DO blocks must go through `quoteSqlString`/`quoteNullableSqlString` from `shared.ts` and must only contain controlled values (hardcoded mappings and IDs already read from our own database) — never user input.

## Current Decisions

- V1 `user` is renamed to `old_user` so the new Drizzle `user` table can be created. The `old_user` migration runs before person inserts so user-scoped custom people can satisfy the new `entity.user_id` foreign key.
- Preserve legacy ids. Derive new emails from the old user name: if the name is a valid email address (`^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$` after lowercasing), use it directly; otherwise synthesize `normalized_name@ryot.local`. Collisions (duplicate real emails or duplicate synthetic local parts) append `+{id}` before the `@`. New users get `email_verified = true`.
- After `old_user` is migrated, each legacy user is passed through `bootstrapNewUser` so migrated accounts receive the built-in trackers, saved views, and library entity that auth-created users get.
- All V1 entities (`metadata`, `metadata_group`, `person`, `collection`, `exercise`, `workout_template`, `workout`) are migrated to the V2 `entity` table with `entity_schema_id`/`sandbox_script_id` derived from the V1 `lot`/`source`. Relationship tables are migrated to V2 `relationship` rows. Workout sets become `event` rows. The authoritative field-level mappings live in the migration SQL — do not duplicate them here.
- V1 `user_measurement` rows are migrated to the V2 `entity` table under the `measurement` entity schema. The composite PK `(user_id, timestamp)` has no UUID equivalent; entity ids are derived as `md5(user_id || '|' || timestamp::text)`. Entity name uses the V1 `name` when not null/empty, falling back to `Measurement - YYYY-MM-DD HH24:MI`. The primary image from `information.assets` is migrated to `entity.image`; assets beyond the primary image are not migrated. V1 has no per-statistic unit field; `unit` has been removed from the V2 measurement statistics schema entirely. Statistics `key` is a normalized snake_case version of the V1 `name` field.
- V1 `seen` rows become V2 `event` rows. Each row expands into one or more events; the full expansion and clamping logic is in `seen-mapping.ts`, and the episodic completion backfill is in `seen-completion-mapping.ts`.
- V1 scheduled a post-import workout revision job after workout writes. V2 does not have an equivalent workout revision scheduler, and legacy bootstrap intentionally does not schedule one after workout/entity/set-event migration.
- V1 `user_to_entity` rows for global entities (metadata, metadata_group, person, github-sourced exercises) are migrated to V2 `in-library` relationships linking the entity to the user's library entity. Collection and user-owned custom exercise rows are silently skipped via `INNER JOIN "entity" src … AND src.user_id IS NULL`. `media_reason`, `exercise_extra_information`, `exercise_num_times_interacted`, `collection_extra_information`, and `needs_to_be_updated` are dropped — V2 derives the equivalent signals from events and relationships.

## Ignored For Now

**user_measurement**: Assets beyond the primary image (additional remote/S3 images) are not migrated to V2.

**metadata_group**: Groups for lots without V2 entity schemas (`anime`, `manga`, `show`, `podcast`, `visual_novel`) are silently skipped. `metadata_group_to_person` is migrated only for music and video game groups (`person-to-music-group`, `person-to-video-game-group`).

**review**: `visibility` (V2 has no visibility concept), `comments` (V2 has no comments on events). See `review-mapping.ts` for rating clamping and NULL-rating handling details.

**seen**: `review_id` (no inter-event references in V2), `manual_time_spent` on `InProgress` and episodic rows (V2 `progress` events have no `timeSpent`), `started_on` on `InProgress` and episodic rows (V2 `progress` events have no `startedOn`). Legacy IDs are not preserved — one seen row expands to multiple events; deterministic md5 IDs are used instead. See `seen-mapping.ts` for the full skipped-data list.

**user**: OAuth redirect URL, sessions, `USERS_TOKEN_VALID_FOR_DAYS` (Better Auth owns session lifetime), `extra_information`, legacy admin `lot`. Legacy `is_disabled` migrates to `banned_at` using `last_login_on`, or `created_on + 90 days` when no last login exists. 2FA is dropped. Password users migrate without credential accounts and are recovered through god-mode reset links. OIDC identity links are migrated as minimal Better Auth account stubs so OIDC sign-in keeps working.

## Local Testing

1. Restore the prod dump into the local DB (running inside docker):

```bash
export PGHOST=localhost PGDATABASE=postgres PGPASSWORD=postgres PGUSER=postgres && dropdb "$PGDATABASE" --force && createdb "$PGDATABASE" && pg_restore -d "$PGDATABASE" < tmp/file.sql
```

Use `ls tmp/` to confirm file names. `tmp/file2.sql` is a larger dump useful for catching edge cases — test with both before finalizing changes.

2. Run the app backend in migrate-only mode:

```bash
cd apps/app-backend && bun run run-migration
```

3. Inspect the logs and verify the migrated rows against the same local DB.

4. You may create another database in the running Postgres instance, restore the dump into it, and inspect it with `psql`.
