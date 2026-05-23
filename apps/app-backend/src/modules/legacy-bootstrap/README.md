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

After trusted system package ingestion, migration builds one package-resolution context from the active loader snapshot and matching active persisted `media` and `fitness` packages. The context qualifies definitions, providers, integration providers, and current scripts by stable plugin ID plus local slug. Provider targets never resolve by a globally unique slug; persisted providers no longer declared by their exact active package are stale, and missing, stale, or ambiguous required mappings fail migration.

Legacy users are inserted before the context is completed. The context then creates deterministic, restart-safe, ready media and fitness installations for every legacy user and records each exact installation ID. Normal user bootstrap runs afterward with plugin bootstrap dispatch disabled, so it retains these installations while still creating ordinary built-in views and default notification subscriptions. Installation-owned migration work starts only after this step.

## Domain Decisions

### Users And Authentication

- Preserve legacy IDs.
- Use lowercased legacy username when it is an email; otherwise generate `<normalized-name>@ryot.local`. Resolve collisions with `+<id>` and mark migrated email verified.
- Run each migrated user through `bootstrapNewUser` after deterministic system installations and the library entity exist. Plugin user-bootstrap scripts remain disabled; ordinary built-in saved views and default notification subscriptions still run.
- Migrate disabled users to `disabled_at`. Password users have no migrated credential account and use god-mode reset links. OIDC links migrate as minimal Better Auth account stubs.
- Do not migrate sessions, 2FA, OAuth redirect URL, legacy admin lot, or legacy token lifetime.

### Media And Provider Entities

- Migrate referenced `metadata`, `metadata_group`, and person/company rows as provider skeletons; migrate custom rows fully.
- Expand V1 show and podcast season/episode blobs into dedicated V2 child entities and parent-child relationships before seen and review events. Positional temp mappings resolve legacy episode references.
- Skip non-referenced provider entities and provider-only suggestion, genre, and relationship rows. V2 population reconstructs them.
- Do not copy V1 `entity_translation`; V2 refills language overlays.

### Measurements, Workouts, And Exercises

- Migrate `user_measurement` to `measurement` entities. IDs are deterministic MD5 values from user ID and timestamp; statistic keys normalize from names. Assets and per-statistic units are omitted.
- Migrate workouts and templates to entities, workout sets to events, and repeated/template links to relationships. Workout, template, template-exercise, and workout-set media is normalized into top-level `images` and `videos` arrays; `workout-mapping.ts` owns these field mappings.
- Migrate GitHub exercises as populated catalog entities and custom exercises in full. GitHub rows cannot have creator user IDs.
- V2 has no equivalent post-import workout revision scheduler, so bootstrap schedules none.

### Events And Collections

- Expand V1 `seen` rows into V2 events. Resolve show and podcast positions to episode entities; skip unresolved positions. Regular show-episode and podcast-episode lifecycle events use their parent as `sessionEntityId`, while season-zero specials remain sessionless. Completed episode rows create explicit child `complete` events after their final progress event. Anime and manga retain flat positional properties.
- Replay migrated show and podcast child lifecycle events in `occurredAt`, `createdAt`, and `id` order. Later progress reopens an episode. Complete regular-episode coverage emits an authoritative parent `complete` event and starts the next rewatch cycle only when production status is `Ended`, `Canceled`, or `Cancelled`, matched case-insensitively; other shows and podcasts remain `caught_up`. Empty regular seasons, specials-only shows, and empty podcasts cannot complete.
- Migrate show and podcast `dropped` and `on_hold` as parent events with self-session so they interrupt child-derived progress. Reviews remain historical events outside lifecycle sessions.
- Convert reviews to `review` events with matching episode resolution. Omit visibility and comments.
- Migrate `user_to_entity` global rows to `in-library`; skip collections and user-owned custom exercises in this path.
- Migrate `Owned` collection normally, then annotate existing library relationships with legacy ownership metadata.
- Migrate `Monitoring` collection normally and create `media-monitoring` relationships for monitorable global provider entities.
- Create a historical `add-entity-to-collection` event for each migrated collection membership.

### Assets

- Migrate legacy `s3` asset locators embedded in `entity` and `event` properties into `managed_asset` rows. Each locator is streamed from its legacy key to compute a SHA-256 digest and copied to a content-addressed `permanent/<owner-namespace>_<sha256>.<extension>` key owned by the referencing user, then the source row's properties are rewritten to the new key.
- Registration is per user, so a legacy key referenced by several users produces one permanent object per owner. Locators with no user, unresolvable metadata, or an unsupported content type are reported and keep their original locator.
- Delete legacy objects only after the property rewrite is committed, and only when every reference to that key migrated. Keys still referenced by a retained locator survive. Deletion failures are reported and do not fail the bootstrap because the migrated data is already correct; only unreferenced bytes remain in the bucket.

### Integrations, Notifications, And Preferences

- Rename V1 `integration` before Drizzle creates V2 table. Resolve every supported integration provider from the exact active media package, validate converted settings against that provider's current manifest schema, and attach each row to its owner's resolved media installation. Skip removed `generic_json` rows with a report entry, fail on other unknown providers or invalid settings, and omit trigger history.
- Migrate unexpired integration completion debounce markers to V2 persistent Redis claims using the exact current media script and a verified owner media installation. Resolve show and podcast markers to migrated episode entities, normalize known integration provider labels, preserve the longest remaining expiry when V1 rows collapse to one V2 fingerprint, and skip reported unresolved targets or ambiguous browser-extension and removed-provider labels. The V1 threshold setting is external deployment configuration; set `RYOT_PLUGIN_MEDIA_PROGRESS_UPDATE_THRESHOLD_HOURS` separately when V2 should retain a non-default threshold after migrated claims expire.
- Migrate unexpired YouTube Music listening cache rows to V2 persistent Redis claims for integrations owned by the resolved media installations and the exact current YouTube Music script. A pending V1 row creates the `seen` claim; a completed row creates both `seen` and `completed`. Writes use the remaining V1 expiry and do not replace claims created by an earlier bootstrap attempt.
- Rename `notification_platform` and convert supported specifics into V2 channels. Drop credential-bearing descriptions and event filters; bootstrap installs default subscriptions.
- Migrate V1 `general.display_nsfw` to `allowNsfw`, preserving V1's `true` default, and migrate `disableIntegrations`.
- Migrate legacy feature preferences into built-in saved-view disabled state through each user's exact media and fitness installation IDs. Media parent and child flags control media-lot, people/company, and group views; fitness parent and child flags control fitness views; the collections flag controls the kernel collections view. Feature flags change view disablement only.
- Do not migrate per-provider languages; V2 starts with global language `null` for canonical content.
- Audible marketplace is fixed provider identity, not translation preference, and is not migrated.

Mapping files in this directory own exact field transforms, clamping, deterministic IDs, and SQL statements.

Plugin-defined entities, events, relationships, and views retain their qualified stable plugin provenance. Kernel definitions retain `NULL` plugin provenance. Referenced provider entities remain global system-provider skeletons, custom entities remain user-owned, and no private package or unsupported legacy plugin state is synthesized.

## Reporting

After Drizzle creates the V2 schema, bootstrap statements write structured rows to the
Drizzle-owned `migration_report` table. Each row contains a sequence, timestamp, phase, level,
message, optional count, and elapsed seconds. The orchestration logs new rows after each phase and
retains the table for post-migration inspection. Pre-migration table renames do not write report rows.

Information rows describe completed work. Warning rows are allowed for the documented unresolved
episode omissions in seen and review migration, unresolved legacy S3 assets, and legacy S3 objects
that could not be deleted after migration. Any other warning fails the bootstrap.

## Validation Runbook

Restore a legacy dump into local Docker database:

```bash
just restore-db 'tmp/file.sql'
```

Run backend migration-only mode:

```bash
cd 'apps/app-backend' && bun run run-migration
```

Inspect logs and migrated rows against the same database. The god-mode Migration Report panel shows
warnings first, then newest rows. Test both normal and larger available dumps; generated-SQL tests
alone do not validate full behavior.
