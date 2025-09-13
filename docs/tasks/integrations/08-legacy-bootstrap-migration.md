# Legacy Bootstrap Migration

**Parent Plan:** [Integrations](./README.md)

**Type:** AFK

**Status:** done

## What to build

Three bootstrap additions: migrate V1 integration configs into the new V2 `integration` table, migrate V1 Owned collection memberships into `in-library` ownership state, and add `disableIntegrations` to the user preference migration.

Refer to the **Legacy Bootstrap — Integration Migration**, **Legacy Bootstrap — V1 Owned Collection Migration**, and **Legacy Bootstrap — User Preference Migration** sections of the parent PRD. Also consult `src/modules/legacy-bootstrap/AGENTS.md` for the fail-fast requirement, SQL style rules (no `public.` prefix, use `quoteSqlString`, `ON CONFLICT DO NOTHING`), and the restart-safe pattern.

**Prerequisite:** Task 01 (the `integration` table must exist via Drizzle migrations before bootstrap can insert into it).

---

### 1. Integration migration — `integration-mapping.ts`

Create `src/modules/legacy-bootstrap/integration-mapping.ts` with a function that returns a SQL `DO $$...$$` block.

**The block must:**

1. **Rename situation (resolved):** the V2 schema reuses the `integration` table name and the Drizzle `CREATE TABLE "integration"` has no `IF NOT EXISTS`, so the pre-existing V1 `integration` table would make the Drizzle migration step fail. It is therefore renamed to `old_integration` in `rename-tables.ts` (before Drizzle runs), exactly mirroring the `user → old_user` pattern; its `integration_pkey` constraint is also renamed (its backing index name would otherwise collide with the V2 table's `integration_pkey`). `drop-tables.ts` drops `old_integration` at the end. The mapping reads from `old_integration` and guards with `IF to_regclass('"old_integration"') IS NULL THEN RAISE EXCEPTION ...`. No V1-vs-V2 column-existence check is needed because the rename happens before the V2 table exists.
2. For each row in the V1 `integration` table, transform and insert into the V2 `integration` table.

**Transformation rules:**

- `id` → preserve exactly as-is (critical for webhook URL continuity).
- `user_id` → `userId` (direct copy).
- `lot` → `lot` (direct copy — already snake_case in V1 DB).
- `provider` → `provider` (direct copy — already snake_case in V1 DB).
- `name` → `name` (direct copy, nullable).
- `is_disabled` → `isDisabled` (`COALESCE(old.is_disabled, false)`).
- `minimum_progress` → `minimumProgress` (`COALESCE(old.minimum_progress, 2)`).
- `maximum_progress` → `maximumProgress` (`COALESCE(old.maximum_progress, 95)`).
- `sync_to_owned_collection` → `syncOwnership` (`COALESCE(old.sync_to_owned_collection, false)`).
- `extra_settings` → `extraSettings` — transform `{ disable_on_continuous_errors: bool }` to `{ disableOnContinuousErrors: bool }` via `jsonb_build_object('disableOnContinuousErrors', COALESCE((old.extra_settings->>'disable_on_continuous_errors')::boolean, false))`.
- `created_on` → `createdAt` (direct copy).
- `last_finished_at` → `lastFinishedAt` (direct copy, nullable).
- `provider_specifics` → `providerSpecifics` — transform from V1 flat snake_case JSONB to V2 discriminated union camelCase JSONB with a `kind` field. Use a `CASE provider WHEN '...' THEN jsonb_build_object(...)` block for each provider. See transformation rules per provider below.
- `trigger_result` — do not migrate (V2 uses `import_run` for history).

**providerSpecifics transformation per provider** (CASE expressions in SQL):

| Provider | V1 fields (snake_case) | V2 fields (camelCase) + `kind` |
|---|---|---|
| `audiobookshelf` | `audiobookshelf_base_url`, `audiobookshelf_token` | `kind`, `baseUrl`, `token` |
| `komga` | `komga_base_url`, `komga_api_key` | `kind`, `baseUrl`, `apiKey` |
| `plex_yank` | `plex_yank_base_url`, `plex_yank_token` | `kind`, `baseUrl`, `token` |
| `youtube_music` | `youtube_music_timezone`, `youtube_music_auth_cookie` | `kind`, `timezone`, `authCookie` |
| `kodi` | (none) | `{ kind: "kodi" }` |
| `emby` | (none) | `{ kind: "emby" }` |
| `plex_sink` | `plex_sink_username` | `kind`, `username` (nullable) |
| `jellyfin_sink` | `jellyfin_sink_username`, `jellyfin_sink_metadata_provider` | `kind`, `username`, `metadataProvider` |
| `generic_json` | (none) | `{ kind: "generic_json" }` |
| `ryot_browser_extension` | `ryot_browser_extension_disabled_sites` | `kind`, `disabledSites` (nullable array) |
| `radarr` | `radarr_base_url`, `radarr_api_key`, `radarr_profile_id`, `radarr_root_folder_path`, `radarr_tag_ids`, `radarr_sync_collection_ids` | `kind`, `baseUrl`, `apiKey`, `profileId`, `rootFolderPath`, `tagIds`, `syncCollectionIds` |
| `sonarr` | `sonarr_base_url`, `sonarr_api_key`, `sonarr_profile_id`, `sonarr_root_folder_path`, `sonarr_tag_ids`, `sonarr_sync_collection_ids` | `kind`, `baseUrl`, `apiKey`, `profileId`, `rootFolderPath`, `tagIds`, `syncCollectionIds` |
| `jellyfin_push` | `jellyfin_push_base_url`, `jellyfin_push_username`, `jellyfin_push_password` | `kind`, `baseUrl`, `username`, `password` |

**Fail fast rule:** If a provider's required fields are NULL in V1 (e.g., `audiobookshelf` with no `audiobookshelf_token`), raise an exception. Optional fields (like `plex_sink_username`) can be NULL. The `CASE` block can validate required fields with a nested `CASE` that raises if they are null.

Use `ON CONFLICT (id) DO NOTHING` on insert for restart-safety.

### 2. Wire into `migrate-data.ts`

In `migrateLegacyTables`, call the integration migration after collection/entity migrations and before drop-tables, following the same pattern as existing mapping calls. Import and call the new function.

### 3. Owned collection migration — `collection-mapping.ts`

In `buildCollectionEntityMigrationSql` and `buildCollectionToEntityRelationshipMigrationSql`, add logic to detect and handle the V1 default `Owned` collection.

**Approach:**

The Owned collection entity row and `member-of` relationships must still be migrated as normal (per user decision: migrate both collection and ownership state). Additionally, for each entity that was in a V1 `Owned` collection, upsert the `in-library` relationship properties to set ownership.

Add a new exported function `buildOwnedCollectionOwnershipMigrationSql(inLibraryRelationshipSchemaId: string)` that returns a SQL `DO $$...$$` block:

1. Find all V1 `collection` rows where `name = 'Owned'`, per user.
2. For each such collection, find all `collection_to_entity` rows pointing to it.
3. For each entity (via `cte.entity_id`), find the user's `in-library` relationship for that entity.
4. Update `relationship.properties` to merge in `{ owned: true, ownershipSources: ["legacy"], ownershipSyncedAt: now }` using `jsonb_build_object` with `||` merging, while preserving any existing properties.

The upsert should handle the case where the `in-library` relationship does not yet exist — but since `user_to_entity_mapping.ts` runs before this, the relationship should already exist for all library entities.

Call this function in `migrate-data.ts` after the collection mapping and user-to-entity mapping have run (order matters: `in-library` relationships must exist before we update their properties).

### 4. User preference migration — `user-auth-mapping.ts`

In the `INSERT INTO "user"` SQL in `user-auth-mapping.ts`, extend the `preferences` `jsonb_build_object` to include `disableIntegrations`:

```sql
'disableIntegrations', COALESCE(
  (legacy_users.preferences -> 'general' ->> 'disable_integrations')::boolean,
  false
)
```

Add this field alongside the existing `isNsfw` and `languages` fields in the `jsonb_build_object` call.

## Acceptance criteria

- [x] After running the legacy bootstrap against a V1 DB dump, all integration rows appear in the V2 `integration` table with correct `id`, `lot`, `provider`, `providerSpecifics` (camelCase, with `kind`), and coalesced defaults.
- [x] `syncOwnership` is set correctly from V1 `sync_to_owned_collection`.
- [x] `extraSettings.disableOnContinuousErrors` is set from V1 `extra_settings`.
- [x] Legacy integration IDs are preserved exactly (not regenerated).
- [x] `trigger_result` is not migrated.
- [x] Integration with missing required provider-specific fields raises an exception (fail fast).
- [x] GenericJson integrations migrate successfully with `{ kind: "generic_json" }` specifics.
- [x] The migration is restart-safe (`ON CONFLICT (id) DO NOTHING`).
- [x] V1 Owned collection entities and `member-of` relationships are migrated as normal V2 collections.
- [x] Additionally, entities from V1 Owned collections have `in-library.properties.owned = true` and `ownershipSources = ["legacy"]`.
- [x] User `disableIntegrations` preference is migrated from `preferences.general.disable_integrations`, defaulting to `false`.
- [x] Bootstrap runs cleanly on both test dump files (`tmp/file.sql` and `tmp/file2.sql`) without errors.

### Validation notes

Both dumps were restored and migrated via `bun run run-migration`, then inspected:

- `tmp/file.sql`: 5 integrations migrated; 72 Owned entities marked owned; user `disableIntegrations = false`.
- `tmp/file2.sql`: 35 integrations across all 12 providers present (no `komga` rows in either dump); 23,883 Owned entities marked owned; 1 user migrated with `disableIntegrations = true`, 279 with `false`.
- All 35 migrated `providerSpecifics` parse against the strict V2 `integrationProviderSpecifics` discriminated union (`radarr`/`sonarr` `profileId` becomes a JSON string, `syncCollectionIds` stays an array, optional fields omitted when absent).
- IDs preserved verbatim (`int_*`), `extraSettings` transformed to camelCase, `kodi`/`emby`/`generic_json`/null-specifics rows reduce to `{ kind }`.
- Re-running the migration on the completed DB is a clean no-op (legacy tables already dropped); integration count stays at 35.

**Rename clarification:** the V1 `integration` table is renamed to `old_integration` in `rename-tables.ts` before Drizzle runs. The V2 schema reuses the `integration` name and the Drizzle `CREATE TABLE "integration"` has no `IF NOT EXISTS`, so the V1 table must be moved aside (and its `integration_pkey` constraint renamed to avoid an index-name collision) or the Drizzle migration step fails. `integration-mapping.ts` reads from `old_integration`; `drop-tables.ts` drops it.

## User stories addressed

- User story 38 (V1 integration configs preserved with same IDs)
- User story 39 (V1 Owned collection memberships become ownership state)
- User story 40 (V1 Owned collection also migrated as normal collection)
- User story 41 (V1 GenericJson integration migrated with config)
- User story 43 (V1 config parity for scheduler/preference env vars)
