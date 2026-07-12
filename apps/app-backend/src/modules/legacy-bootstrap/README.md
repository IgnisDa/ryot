# Legacy Bootstrap

This module migrates deployed V1 Rust backend data into V2 TypeScript schema during startup. Fresh V2 installations and normal e2e suite do not exercise it.

## Migration Model

User-generated data migrates in full. Provider-sourced data migrates only when referenced by user data because provider population can reconstruct it.

- User-authored entities retain IDs and complete properties and have no provider.
- Referenced provider entities retain identity and name but start as skeletons with empty properties and `populated_at = NULL`.
- Unreferenced provider entities are omitted.
- Provider identity is `(external_id, entity_schema_slug, provider_id)` for global rows and includes `user_id` for user-scoped rows. Provider ID, not sandbox script ID, is provenance.
- `_referenced_global_entity_ids` collects entities referenced by seen events, reviews, collections, library membership, and user-authored relationship endpoints.
- Provider-derived relationships are rebuilt during population. Only user-authored relationship rows migrate.

Provider targets resolve against active plugin-loader declarations. Persisted providers no longer declared by active plugins are stale; unresolved target provider slugs fail migration.

## Domain Decisions

### Users And Authentication

- Preserve legacy IDs.
- Use lowercased legacy username when it is an email; otherwise generate `<normalized-name>@ryot.local`. Resolve collisions with `+<id>` and mark migrated email verified.
- Run each migrated user through `bootstrapNewUser` to create plugin workspace state, saved views, library entity, and default notification subscriptions.
- Migrate disabled users to `disabled_at`. Password users have no migrated credential account and use god-mode reset links. OIDC links migrate as minimal Better Auth account stubs.
- Do not migrate sessions, 2FA, OAuth redirect URL, legacy admin lot, or legacy token lifetime.

### Media And Provider Entities

- Migrate referenced `metadata`, `metadata_group`, and person/company rows as provider skeletons; migrate custom rows fully.
- Expand V1 show and podcast season/episode blobs into dedicated V2 child entities and parent-child relationships before seen and review events. Positional temp mappings resolve legacy episode references.
- Skip non-referenced provider entities and provider-only suggestion, genre, and relationship rows. V2 population reconstructs them.
- Do not copy V1 `entity_translation`; V2 refills language overlays.

### Measurements, Workouts, And Exercises

- Migrate `user_measurement` to `measurement` entities. IDs are deterministic MD5 values from user ID and timestamp; statistic keys normalize from names. Assets and per-statistic units are omitted.
- Migrate workouts and templates to entities, workout sets to events, and repeated/template links to relationships. `workout-mapping.ts` owns field mappings.
- Migrate GitHub exercises as populated catalog entities and custom exercises in full. GitHub rows cannot have creator user IDs.
- V2 has no equivalent post-import workout revision scheduler, so bootstrap schedules none.

### Events And Collections

- Expand V1 `seen` rows into V2 events. Resolve show and podcast positions to episode entities; skip unresolved positions. Anime and manga retain flat positional properties.
- Convert reviews to `review` events with matching episode resolution. Omit visibility and comments.
- Migrate `user_to_entity` global rows to `in-library`; skip collections and user-owned custom exercises in this path.
- Migrate `Owned` collection normally, then annotate existing library relationships with legacy ownership metadata.
- Migrate `Monitoring` collection normally and create `media-monitoring` relationships for monitorable global provider entities.

### Integrations, Notifications, And Preferences

- Rename V1 `integration` before Drizzle creates V2 table. Convert provider settings using active manifest schema and fail on unknown providers or missing required fields. Omit trigger history.
- Rename `notification_platform` and convert supported specifics into V2 channels. Drop credential-bearing descriptions and event filters; bootstrap installs default subscriptions.
- Migrate `disableIntegrations` and `isNsfw` preferences.
- Do not migrate per-provider languages; V2 starts with global language `null` for canonical content.
- Audible marketplace is fixed provider identity, not translation preference, and is not migrated.

Mapping files in this directory own exact field transforms, clamping, deterministic IDs, and SQL statements.

## Validation Runbook

Restore a legacy dump into local Docker database:

```bash
just restore-db 'tmp/file.sql'
```

Run backend migration-only mode:

```bash
cd 'apps/app-backend' && bun run run-migration
```

Inspect logs and migrated rows against same database. Test both normal and larger available dumps; generated-SQL tests alone do not validate full behavior.
