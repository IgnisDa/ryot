# Foundation: Schema, Config, and Builtins

**Parent Plan:** [Integrations](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Lay the complete data layer and configuration foundation that every subsequent task depends on. This task touches no business logic — only DB schema, Drizzle tables, Zod enums, config definitions, and builtin seeding. A later task cannot meaningfully start without these pieces in place.

Refer to the **Database Schema Changes**, **Config / Env Vars**, **Provider List**, and **Builtin Trigger Positions and Slugs** sections of the parent PRD for authoritative field names, types, defaults, and constraints.

### 1. New `integration` Drizzle table

Add a new `integration` table with all columns described in the PRD's "New `integration` table" section. Key points:

- `id` uses the app-backend standard ID generator (same helper used elsewhere in the schema).
- `lot` is a text enum: `"yank"`, `"sink"`, `"push"`.
- `provider` is text — snake_case provider ID stored as-is (no DB-level enum; validated at application layer).
- `providerSpecifics` is `jsonb`, typed as the Zod discriminated union (see below).
- `minimumProgress` and `maximumProgress` are decimal, not null, default `2` and `95` respectively.
- `syncOwnership` is boolean, not null, default `false`.
- `isDisabled` is boolean, not null, default `false`.
- `extraSettings` is `jsonb`, not null.
- `lastFinishedAt` is `timestamp with timezone`, nullable.
- FK: `userId` references the `user` table with cascade delete/update.
- Indexes: `(userId, createdAt desc)`, `(userId, provider)`, `(lot, isDisabled)`, `(provider, isDisabled)`.

### 2. `import_run` table changes

- Add nullable `integrationId` column — text, FK to `integration(id)` with `ON DELETE CASCADE`.
- Add index `(integrationId, createdAt desc)`.

### 3. `event_schema_trigger` table changes

- Add `phase` column — text, not null, default `"after_create"`. Valid values: `"before_create"`, `"after_create"`.
- Add `position` column — integer, not null, default `1000`. Lower values run first within a phase.
- All existing rows implicitly receive defaults `phase = "after_create"`, `position = 1000` via column defaults.

### 4. `in-library` relationship schema property expansion

In `src/modules/builtins/relationship-schemas.ts`, widen the builtin `in-library` relationship `propertiesSchema` to include three optional fields:

```
owned?: boolean
ownershipSources?: string[] (array of strings)
ownershipSyncedAt?: datetime
```

This is an additive schema change; existing rows with `properties = {}` remain valid because all new fields are optional.

### 5. `ImportRunFailureStage` enum extension

Add `"event_before_trigger"` to the `importRunFailureStage` enum in `src/modules/imports/schemas.ts`. No other changes to imports schemas.

### 6. `importRunSource` enum extension

Extend `importRunSource` in `src/modules/imports/schemas.ts` to include all integration provider IDs as valid values: `plex_yank`, `plex_sink`, `komga`, `audiobookshelf`, `youtube_music`, `kodi`, `emby`, `jellyfin_sink`, `generic_json`, `ryot_browser_extension`, `radarr`, `sonarr`, `jellyfin_push`.

### 7. Config additions

In `src/lib/config/definition.ts`, add a new `scheduler` group under `systemConfigDef` with three fields:

| Field                          | Env key                                   | Default             | Description                                                              |
| ------------------------------ | ----------------------------------------- | ------------------- | ------------------------------------------------------------------------ |
| `frequentCronJobsSchedule`     | `SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE`   | `"every 5 minutes"` | English cron phrase for Yank integration polling                         |
| `infrequentCronJobsSchedule`   | `SCHEDULER_INFREQUENT_CRON_JOBS_SCHEDULE` | `"every midnight"`  | Ported for config parity; not actively used by integrations in this plan |
| `progressUpdateThresholdHours` | `SERVER_PROGRESS_UPDATE_THRESHOLD`        | `"2"`               | Integer hours; controls completion dedupe window                         |

In `src/lib/config/index.ts`, parse and expose all three as typed values on the `config` object (string → integer for threshold, string pass-through for cron phrases).

### 8. User preferences schema

In `src/modules/builtins/preferences.ts`, add `disableIntegrations: z.boolean().default(false)` to `userPreferencesSchema` and `defaultUserPreferences`.

### 9. `EventSchemaTriggerMetadata` schema

The `eventSchemaTriggerMetadataSchema` in `src/lib/sandbox/types.ts` currently only has `inheritedProperties`. No changes are needed in this task — `phase` and `position` are table columns, not metadata fields. Confirm that no metadata changes are required.

### 10. Builtin event schema trigger link positions

In the builtins manifests (`src/modules/builtins/manifests.ts` or wherever `builtinEventSchemaTriggerLinks` is defined), update the existing auto-complete trigger link to explicitly set `position = 1000` and `phase = "after_create"`. This ensures the seeding upsert writes the correct values rather than relying purely on column defaults. No new trigger links are added in this task — those come in tasks 03 and 07.

## Acceptance criteria

- [ ] `integration` table exists in the DB after running Drizzle migrations with all columns, constraints, and indexes matching the PRD spec.
- [ ] `import_run` table has a nullable `integrationId` FK column with cascade delete and the new index.
- [ ] `event_schema_trigger` table has `phase` (default `"after_create"`) and `position` (default `1000`) columns. Existing rows get the defaults.
- [ ] Builtin `in-library` relationship schema includes the three optional ownership fields after seeding.
- [ ] `"event_before_trigger"` is a valid value for `importRunFailureStage`.
- [ ] All integration provider IDs are valid values for `importRunSource`.
- [ ] `SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE`, `SCHEDULER_INFREQUENT_CRON_JOBS_SCHEDULE`, and `SERVER_PROGRESS_UPDATE_THRESHOLD` are documented in generated config docs.
- [ ] `config.scheduler.frequentCronJobsSchedule`, `config.scheduler.infrequentCronJobsSchedule`, and `config.scheduler.progressUpdateThresholdHours` are accessible at runtime.
- [ ] `defaultUserPreferences.disableIntegrations === false` and the field parses correctly from stored JSON.
- [ ] Drizzle migration runs cleanly on a fresh DB and on a DB with existing rows (restart-safe).

## User stories addressed

- User story 37 (configure Yank polling schedule via env)
- User story 43 (English cron phrase syntax matching V1)
- User story 35 (disable all integrations via user preference)
