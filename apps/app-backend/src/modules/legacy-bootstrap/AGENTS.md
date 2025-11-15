# Legacy Bootstrap Agent Notes

The purpose of this module is to migrate legacy V1 Rust data (`apps/backend`) into the V2
TypeScript backend (`apps/app-backend`) during startup.

## Fail-Fast Requirement

Every step in this module must fail loudly on unexpected state. Use `throw new Error(...)` in TypeScript and `RAISE EXCEPTION '...'` in PL/pgSQL DO blocks — never `RETURN` from a DO block when the missing object signals an error rather than an already-completed step.

The only permitted silent-skip patterns are:

- **Idempotent guards**: skipping work that has already been done on a previous startup (e.g., `IF to_regclass('"old_user"') IS NOT NULL THEN RETURN; END IF;` in the rename block — `old_user` already exists means the rename already ran).
- **`ON CONFLICT … DO NOTHING`**: all INSERT statements use this for restart-safety; do not remove them.
- **`DROP TABLE IF EXISTS`**: used in `drop-tables.ts` for restart-safety.
- **`shouldRunLegacyBootstrap` returning `false`**: the three top-level `if (!(await shouldRunLegacyBootstrap(database))) return;` guards in `rename-tables.ts`, `migrate-data.ts`, and `drop-tables.ts` are the intentional main gate — no V1 data present, skip everything.
- **Documented data-level exceptions**: the intentional skips listed in the "Ignored For Now" sections below (metadata group lots without V2 schemas, 2FA, OIDC, sessions, etc.).

Everything else must throw. Do not add new `RETURN` statements inside DO blocks to silently skip unexpected-missing tables or columns.

## Boundaries

- Keep all legacy bootstrap-specific logic inside this module.
- `index.ts` must stay small and only re-export the startup entrypoints.
- Do not edit `src/lib/db/migrate.ts` unless the change has been discussed first.
- Keep the `index.ts` API surface minimal; only re-export the startup entrypoints.
- Run the legacy table rename before Drizzle migrations.
- Run the legacy table data copy after Drizzle migrations have created the new tables.
- Prefer SQL for set-based work. Use TypeScript only for orchestration.
- **Never hardcode `public.` as a schema prefix in SQL statements.** The V1 backend (SeaORM) used bare table names that resolve through PostgreSQL's `search_path`, so V1 tables may live in a non-public schema. Use quoted bare table names (e.g., `"old_user"`, `"metadata"`) instead of `public.table_name` to resolve correctly regardless of schema. See #1372.
- Progress reporting for bulk legacy migration steps currently uses PostgreSQL `DO $$ ... $$` blocks with `RAISE NOTICE` so row counts can be emitted from SQL via `GET DIAGNOSTICS ... ROW_COUNT`.
- Because PostgreSQL `DO` blocks do not accept external query parameters, SQL value lists embedded in those blocks must be inlined. Only use this pattern with controlled values owned by this module (hardcoded mappings and IDs already read from our own database), not user input.
- If a `PoolClient` gets a temporary `notice` listener for legacy bootstrap logging, always remove that listener before releasing the client back to the pool.

## Current Decisions

- V1 `user` is renamed to `old_user` so the new Drizzle `user` table can be created.
- V1 `metadata` is migrated to `entity` with empty `properties`, the first legacy image preserved, `external_id = identifier`, `entity_schema_id`/`sandbox_script_id` derived from `lot`/`source` (with `Custom` rows keeping a null sandbox script), and `populated_at = last_updated_on` for the first pass.
- V1 `metadata_group` is migrated to `entity` following the same pattern as `metadata`: empty `properties`, first image preserved, `external_id = identifier`, `entity_schema_id`/`sandbox_script_id` derived from `lot`/`source`. `created_at` and `updated_at` are both set to `last_updated_on` (V1 `metadata_group` has no `created_on` column). Legacy ids are preserved. Lots without a V2 group entity schema (`anime`, `manga`, `show`, `podcast`, `visual_novel`) are silently skipped via the migration join; all other lots with unsupported sources cause a hard error.
- V1 `metadata_to_metadata_group` (the many-to-many between metadata and groups) is migrated to `relationship` rows using the appropriate builtin group-to-media relationship schema (e.g., `movie-group-to-movie`). Relationship `properties` are empty (`{}`); the `part` field has no V2 equivalent in `groupRolesPropertiesSchema` and is dropped.
- V1 `person` is migrated to `entity` and split into the V2 `person` and `company` schemas. Rows flagged as company-like in `source_specifics` (`is_tmdb_company`, `is_tvdb_company`, `is_anilist_studio`, `is_giant_bomb_company`, `is_hardcover_publisher`) become `company`; everything else remains `person`. `created_by_user_id` is preserved as `user_id` on custom rows, `image` preserves the first legacy image, `properties.images` preserves the full legacy image list, and the shared scalar fields map into the matching V2 person/company properties. Sources without dedicated V2 person scripts that we still want to keep (`custom`, `igdb`, `manga_updates`) stay as null-script person entities.
- V1 `metadata_to_person` is migrated to `relationship` rows by grouping legacy credit rows per `(metadata_id, person_id, user_id)` pair. `role` becomes `roles[]`, `index` becomes `order` (minimum credit order), and `character` is preserved for person relationships but stripped from company relationships. Custom-person relationships are user-scoped via the preserved `created_by_user_id`.
- The legacy `old_user` migration now runs before person inserts so user-scoped custom people can satisfy the new `entity.user_id` foreign key.
- V1 `collection` is migrated to `entity` with `entity_schema_id` derived from the `"collection"` entity schema slug and `sandbox_script_id = NULL`. `name`, `created_on` → `created_at`, `last_updated_on` → `updated_at`, and `user_id` map directly. `description` is stored as `properties.description` (omitted when NULL). `information_template` (a V1 array of field descriptors) is converted to `properties.membershipPropertiesSchema` (a V2 `AppSchema` object): each element's `name` becomes the field key and `label`; `lot` maps to the V2 type (`Date`→`date`, `Number`→`number`, `Boolean`→`boolean`, `DateTime`→`datetime`, `StringArray`→`array`, `String`→`string`; a non-empty `possible_values` array overrides the type to `enum` or `enum-array` for `StringArray`); `default_value` (always a JSON string in V1) is cast to the appropriate JSON type for storage (`::numeric` for Number, `::boolean` for Boolean, string for all others); `required: true` becomes `validation.required: true`. The `membershipPropertiesSchema` key is omitted entirely when `information_template` is NULL or empty. `external_id`, `image`, and `populated_at` are NULL. Legacy IDs are preserved.
- Preserve legacy ids.
- Derive new emails from the old user name as `name@ryot.local`, with normalization and a stable fallback for collisions.
- New users get `email_verified = true` because the legacy account was already trusted.

## Ignored For Now (metadata_group)

- `metadata_group_to_person`: no V2 relationship schema exists that links a group entity to a person entity.
- Group `properties` fields (`parts`, `description`, `source_url`): deferred to re-population from the source provider, matching the same decision made for `metadata`.
- Metadata groups for lots without V2 group entity schemas (`anime`, `manga`, `show`, `podcast`, `visual_novel`): silently skipped, no V2 schema exists for them.

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

1. Restore the prod dump into the local DB (running inside docker):

```bash
export PGHOST=localhost PGDATABASE=postgres PGPASSWORD=postgres PGUSER=postgres && dropdb "$PGDATABASE" --force && createdb "$PGDATABASE" && pg_restore -d "$PGDATABASE" < tmp/file.sql
```

The directory is `./tmp` and not `/tmp`. use `ls` to check instead of the grep tool.

2. Run the app backend:

```bash
bun turbo --filter=@ryot/app-backend dev 2>&1 | tee /tmp/ryot-app-backend-dev.log
```

3. Inspect the logs and verify the migrated rows via MCP against the same local DB.

4. You may create another database in the running Postgres instance, restore the dump into it, and inspect it with `psql`. MCP will not have access to that newly created database.
