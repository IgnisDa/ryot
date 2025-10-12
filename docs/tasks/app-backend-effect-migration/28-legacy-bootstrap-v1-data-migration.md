# Legacy Bootstrap V1 Data Migration

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** done

## What to build

Port the `legacy-bootstrap` module from the legacy backend to the new Effect backend. This module migrates V1 Rust backend data (`apps/backend`) into the V2 TypeScript backend during startup. It runs once per deployment when V1 tables are detected and is idempotent on restart.

The module has three startup phases that must remain in order: rename V1 tables before Drizzle migrations, migrate V1 data after migrations and seeding, then drop the renamed V1 tables. The new implementation must wire these phases into the Effect startup sequence and use the Effect-based `bootstrapNewUser` for migrated legacy users.

Port all SQL mapping files from the legacy module. The SQL builders can be ported largely as-is; only the orchestration layer and db access patterns change to match the new Effect backend. A `run-migration` script and `RUN_LEGACY_BOOTSTRAP_ONLY` env var must be added to the new backend for operator use when migrating production databases.

## Acceptance criteria

- [ ] `renameLegacyTables` runs before Drizzle migrations in the startup sequence
- [ ] `migrateLegacyTables` runs after Drizzle migrations and seed in the startup sequence
- [ ] `dropLegacyTables` runs after data migration completes
- [ ] `shouldRunLegacyBootstrap` gate correctly skips all steps when no V1 data is present
- [ ] Migrated legacy users receive full V2 bootstrap data via the Effect-based `bootstrapNewUser`
- [ ] All V1 entity types are migrated: metadata, metadata_group, person, collection, exercise, workout_template, workout, user_measurement
- [ ] V1 `seen` rows expand to V2 event rows per the existing mapping logic
- [ ] V1 `review` rows migrate to V2 event rows with rating clamping
- [ ] V1 `integration` rows migrate to the V2 `integration` table with provider field remapping
- [ ] V1 `user_to_entity` rows migrate to V2 `in-library` relationships
- [ ] V1 `Owned` collection rows migrate with ownership metadata on `in-library` relationships
- [ ] Startup is fail-fast on unexpected state and idempotent on restart per the module AGENTS.md rules
- [ ] `package.json` has a `run-migration` script that sets `RUN_LEGACY_BOOTSTRAP_ONLY=true`
- [ ] Backend starts normally and skips migration cleanly when no V1 tables are present

## Notes

- All behavioral rules, SQL conventions, fail-fast requirements, and data-level skip decisions are documented in `apps/app-backend/src/modules/legacy-bootstrap/AGENTS.md`. That file is the authority for this module.
- The legacy implementation in `apps/app-backend-legacy/src/modules/legacy-bootstrap/` is the source of truth for SQL mapping logic. Port it faithfully; do not redesign the migration strategy.
- The only orchestration dependency on domain services is `bootstrapNewUser` from `~/modules/builtins`. All other writes go directly to V2 tables via raw SQL executed through the db pool client.
- The rename and drop phases do not need Effect layer integration; they can be plain async functions called from the Effect startup sequence via `Effect.tryPromise`.
- Wiring into `src/lib/db/migrate.ts` or a new startup layer is acceptable as long as the phase order is preserved and the AGENTS.md constraint against editing `migrate.ts` without discussion is respected.

## User stories addressed

Reference by number from the parent PRD:

- User story 52
- User story 64
