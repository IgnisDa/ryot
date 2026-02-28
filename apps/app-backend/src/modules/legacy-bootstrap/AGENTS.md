# Legacy Bootstrap Agent Notes

This is a living document and must be kept up to date as the module evolves.

The purpose of this module is to migrate legacy V1 Rust data (`apps/backend`) into the V2
TypeScript backend (`apps/app-backend`) during startup.

## Fail-Fast Requirement

Every step in this module must fail loudly on unexpected state. Use `throw new Error(...)` in TypeScript and `RAISE EXCEPTION '...'` in PL/pgSQL DO blocks — never `RETURN` from a DO block when the missing object signals an error rather than an already-completed step.

Permitted silent-skip patterns: idempotent guards (work already done on a previous startup), `ON CONFLICT … DO NOTHING` on all inserts (restart-safety), `DROP TABLE IF EXISTS` in `drop-tables.ts` (restart-safety), `legacyBootstrapGate` returning `false` (main gate — no V1 data present), and the intentional data-level skips listed in "Ignored For Now" below. Everything else must throw.

## Boundaries

- Keep all legacy bootstrap-specific logic inside this module.
- Do not add automated tests inside this module; validate changes by restoring the legacy dump, running `bun run run-migration`, and inspecting the migrated rows via MCP.
- Do not edit `src/lib/infrastructure/db/migrate.ts` unless the change has been discussed first.
- Run the legacy table rename before Drizzle migrations.
- Run the legacy table data copy after Drizzle migrations have created the new tables.
- Prefer SQL for set-based work. Use TypeScript only for orchestration.
- **Never hardcode `public.` as a schema prefix in SQL statements.** The V1 backend (SeaORM) used bare table names that resolve through PostgreSQL's `search_path`, so V1 tables may live in a non-public schema. Use quoted bare table names (e.g., `"old_user"`, `"metadata"`) instead of `public.table_name` to resolve correctly regardless of schema. See #1372.
- SQL value lists inlined into DO blocks must go through `quoteSqlString`/`quoteNullableSqlString` from `shared.ts` and must only contain controlled values (hardcoded mappings and IDs already read from our own database) — never user input.

## Slim Migration Strategy

The migration copies **user-generated data in full** and **provider-sourced ("global") data only as far as user data references it**. Provider entities (`metadata`, `metadata_group`, `person`/company and their season/episode children) are fully reconstructable on demand: V2's entity population workflow refetches an entity from its provider using the `(external_id, entity_schema_id, sandbox_script_id)` tuple and rebuilds its `name`/`properties`, child entities, and all related-entity relationships (cast/crew, group membership, genres, media suggestions). A skeleton row (`populated_at = NULL`, `properties = {}`) is a first-class state that populates lazily on first view (interest declaration) or via the media-monitoring refresh cron.

Consequences that drive the design below:

- **Custom (user-authored) entities have no provider** (`sandbox_script_id IS NULL`) and can never be repopulated, so they are always migrated in full with their `properties`.
- **Provider entities are migrated only when referenced by user data**, and then only as skeletons (`name` copied, `properties = {}`, `populated_at = NULL`). The "referenced" set is every entity id appearing in `seen.metadata_id`, `review.entity_id`, `collection_to_entity.entity_id`, or `user_to_entity.entity_id`, collected once into the session temp table `_referenced_global_entity_ids` by `buildReferencedGlobalEntityIdsSql` in `shared.ts`.
- **Provider-derived relationship/link tables are migrated only for user-authored rows** (a row where either endpoint is a user-owned custom entity). The provider/global rows are dropped and rebuilt on population. Endpoints of user-authored rows are added to `_referenced_global_entity_ids` so any provider-side endpoint still gets a skeleton, and the inserts INNER JOIN `entity` on both endpoints for FK-safety. `metadata_to_metadata` (media suggestions) has no user-authored form and is skipped entirely via a fail-loud guard.

## Current Decisions

- V1 `user` is renamed to `old_user` so the new Drizzle `user` table can be created. The `old_user` migration runs before entity inserts so user-scoped custom entities can satisfy the new `entity.user_id` foreign key.
- Preserve legacy ids. Derive new emails from the old user name: if the name is a valid email address (`^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$` after lowercasing), use it directly; otherwise synthesize `normalized_name@ryot.local`. Collisions (duplicate real emails or duplicate synthetic local parts) append `+{id}` before the `@`. New users get `email_verified = true`.
- After `old_user` is migrated, each legacy user is passed through `bootstrapNewUser` so migrated accounts receive the built-in trackers, saved views, and library entity that auth-created users get.
- **Referenced provider entities are migrated as skeletons.** `metadata`, `metadata_group`, and `person`/company entity migrations filter provider rows (`sandbox_script_id IS NOT NULL`) to `_referenced_global_entity_ids` and emit `properties = '{}'::jsonb` with `populated_at = NULL`; V2 repopulates them from their provider on first view. `entity_schema_id`/`sandbox_script_id` are still derived from the V1 `lot`/`source`, and `external_id`/`name` are copied so the row is identifiable and reconstructable.
- **Custom entities are migrated in full.** Rows whose resolved `sandbox_script_id IS NULL` (V1 `source = 'custom'`) keep their full computed `properties` regardless of whether they are referenced, because there is no provider to rebuild them from.
- V1 show/podcast season and episode blobs are exploded into V2 `show-season`, `show-episode`, and `podcast-episode` entities by `episodic-sub-entity-mapping.ts`. Because the explosion joins the already-migrated parent `entity` row, it naturally covers only referenced/custom shows and podcasts. It runs immediately after metadata entities are migrated and before review/seen events, and writes the parent-child relationships plus the session-local episode resolution temp tables reused by review/seen migration. These children still carry their positional `seasonNumber`/`episodeNumber` (needed so episode-level seen/review resolve at migration time); provider repopulation later upserts them in place on the same `(external_id, entity_schema_id, sandbox_script_id)` tuple.
- V1 `user_measurement` rows are migrated to the V2 `entity` table under the `measurement` entity schema. The composite PK `(user_id, timestamp)` has no UUID equivalent; entity ids are derived as `md5(user_id || '|' || timestamp::text)`. Entity name uses the V1 `name` when not null/empty, falling back to `Measurement - YYYY-MM-DD HH24:MI`. V1 has no per-statistic unit field; `unit` has been removed from the V2 measurement statistics schema entirely. Statistics `key` is a normalized snake_case version of the V1 `name` field.
- V1 `workout`/`workout_template` become V2 `entity` rows and workout sets become `event` rows; relationship tables (`workout-to-workout-template`, `workout-repeated-from`) are migrated to V2 `relationship` rows. The authoritative field-level mappings live in `workout-mapping.ts`.
- V1 `exercise` rows are migrated to the V2 `entity` table. `github`-sourced exercises are a fixed catalog inserted already-populated (`populated_at = NOW()`) rather than as provider skeletons; custom/user exercises are migrated in full. `github` rows must not carry a creator user id (validated up front).
- V1 `seen` rows become V2 `event` rows. Each row expands into one or more events; show/podcast rows with positional episode data resolve to episode entities, anime/manga keep flat positional properties, and unresolved show/podcast episode rows are skipped rather than attached to the parent. The full expansion and clamping logic is in `seen-mapping.ts`, and the episodic completion backfill is in `seen-completion-mapping.ts`.
- V1 `review` rows become V2 `review` events. Show/podcast reviews with positional episode data resolve to episode entities; unresolved ones are skipped. Rating clamping and NULL handling live in `review-mapping.ts`.
- V1 scheduled a post-import workout revision job after workout writes. V2 does not have an equivalent workout revision scheduler, and legacy bootstrap intentionally does not schedule one.
- V1 `user_to_entity` rows for global entities are migrated to V2 `in-library` relationships linking the entity to the user's library entity. Collection and user-owned custom exercise rows are silently skipped via `INNER JOIN "entity" src … AND src.user_id IS NULL`. `media_reason`, `exercise_extra_information`, `exercise_num_times_interacted`, `collection_extra_information`, and `needs_to_be_updated` are dropped — V2 derives the equivalent signals from events and relationships.
- The V1 default `Owned` collection is migrated as a normal V2 collection (entity + `member-of` relationships) by `collection-mapping.ts`, and `buildOwnedCollectionOwnershipMigrationSql` additionally marks each owned entity's existing `in-library` relationship with `{ owned: true, ownershipSources: ["legacy"], ownershipSyncedAt: <now ISO> }`. It runs after `user-to-entity-mapping.ts` (the `in-library` relationships must already exist) and is an `UPDATE` only.
- The V1 default `Monitoring` collection is retained as a normal V2 collection and its global, provider-backed media/person memberships additionally become `media-monitoring` relationships to the matching user's library entity. `buildMonitoringCollectionMigrationSql` runs after the `in-library` and ownership migrations, filters to V2-monitorable schemas, preserves the V1 membership timestamp, and uses `ON CONFLICT DO NOTHING`.
- V1 `integration` is renamed to `old_integration` in `rename-tables.ts` (its PK constraint too, since the backing index name would collide) because V2 reuses the `integration` name and the Drizzle `CREATE TABLE integration` has no `IF NOT EXISTS`. `integration-mapping.ts` copies `old_integration` into V2 `integration`, rebuilding `provider_specifics` as the V2 discriminated union. Required provider fields are validated up front and unknown providers fail fast; optional fields are emitted only when present; inserts use `ON CONFLICT (id) DO NOTHING`.
- V1 `notification_platform` is renamed to `old_notification_platform` before Drizzle migrations (including its PK and user index) because V2 creates the same table name. `notification-platform-mapping.ts` copies platform rows after users exist, maps the tagged `{t,d}` specifics JSON into the V2 `platformSpecifics.kind` union, and drops the legacy credential-bearing description. Unknown platforms, event literals, variant tags, missing required fields, and malformed specifics fail fast; inserts use `ON CONFLICT (id) DO NOTHING`.
- When notification event selection moves from per-platform `configured_events` to sandbox-backed subscriptions, legacy per-platform routing is intentionally broadened: each migrated event subscription targets all of that user's enabled notification platforms. Which event types the user selected is preserved; different event selections for different platforms are not.
- The `disableIntegrations` user preference is migrated from `preferences.general.disable_integrations` (default `false`) alongside `isNsfw` in `user-auth-mapping.ts`.
- V1 per-provider language preferences (`preferences.languages.providers`) are **not** migrated. V2 models translation language as a single global `language` preference (BCP-47); `user-auth-mapping.ts` seeds migrated users with `language: null` (canonical language) and drops the V1 per-provider entries.
- Audible marketplace is an identity concern (it changes the ASIN and therefore the target entity), never a translation overlay, and is no longer a user preference (the Audible provider scripts use a fixed `audible.com` marketplace), so no Audible preference is migrated.

## Ignored For Now

**Provider entity properties**: For referenced provider entities only skeletons are written (`properties = {}`, `populated_at = NULL`); genres, images, and lot-specific properties are not copied because V2 refetches them from the provider on first view. Custom entities keep their full properties.

**Non-referenced provider entities**: `metadata` / `metadata_group` / `person` rows not referenced by any user data are not migrated at all; V2 recreates them (as skeletons, then populated) if a user ever navigates to them.

**Provider relationship/link tables** (`metadata_to_person`, `metadata_group_to_person`, `metadata_to_metadata_group`): only the **user-authored** rows are migrated (rows where the derived `user_id` is not null, i.e. an endpoint is a user-owned custom entity); the provider/global rows are dropped and rebuilt when the parent entity is populated. Endpoints of user-authored rows are pulled into `_referenced_global_entity_ids` (so a provider-side endpoint gets a skeleton) and the inserts INNER JOIN `entity` on both endpoints. Most custom metadata stores its creators as unlinked `free_creators`/`unlinkedCreators` in entity `properties` rather than as person rows, so the user-authored set is small. `metadata_to_metadata` (media suggestions) and `metadata_to_genre` are provider-only and not migrated at all — suggestions via a fail-loud guard, genres implicitly (they live in provider `properties`).

**entity_translation**: V1 `entity_translation` is still renamed to `old_entity_translation` in `rename-tables.ts` (so the Drizzle `entity_translation` table can be created) and dropped in `drop-tables.ts`, but its rows are **not** copied. V2 repopulates per-language overlays from the provider.

**user_measurement**: `information.assets` images are not migrated (the `measurement` schema has no `images` property).

**metadata_group**: Groups for lots without V2 entity schemas (`anime`, `manga`, `show`, `podcast`, `visual_novel`) are silently skipped.

**review**: `visibility` (V2 has no visibility concept), `comments` (V2 has no comments on events). See `review-mapping.ts` for rating clamping and NULL-rating handling.

**seen**: `review_id` (no inter-event references in V2), `manual_time_spent` and `started_on` on `InProgress` and episodic rows (V2 `progress` events have neither). Legacy IDs are not preserved — one seen row expands to multiple events with deterministic md5 IDs. See `seen-mapping.ts` for the full skipped-data list.

**integration**: `trigger_result` (V1 per-run history). V2 tracks integration runs in `import_run` instead.

**user**: OAuth redirect URL, sessions, `USERS_TOKEN_VALID_FOR_DAYS` (Better Auth owns session lifetime), `extra_information`, legacy admin `lot`. Legacy `is_disabled` migrates to `disabled_at` using `last_login_on`, or `created_on + 90 days` when no last login exists. 2FA is dropped. Password users migrate without credential accounts and are recovered through god-mode reset links. OIDC identity links are migrated as minimal Better Auth account stubs so OIDC sign-in keeps working.

## Local Testing

1. Restore the prod dump into the local DB (running inside docker):

```bash
just restore-db tmp/file.sql
```

Use `ls tmp/` to confirm file names. `tmp/file2.sql` is a larger dump useful for catching edge cases — test with both before finalizing changes.

2. Run the app backend in migrate-only mode:

```bash
cd apps/app-backend && bun run run-migration
```

3. Inspect the logs and verify the migrated rows against the same local DB.

4. You may create another database in the running Postgres instance, restore the dump into it, and inspect it with `psql`.
