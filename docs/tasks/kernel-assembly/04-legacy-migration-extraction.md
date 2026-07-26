# Legacy Migration Extraction

**Parent Plan:** [Kernel Assembly](./README.md)

**Status:** done

## What to build

Move the Rust V10 adoption path out of the kernel and invert its dependency direction, following the parent plan's Server Assembly and Legacy Migration decisions. The migration keeps running automatically during startup; only its ownership changes.

Export discrete layer stages from the kernel's composition module instead of one pre-sequenced application layer: schema migration, system plugin ingestion, and the runtime server. Layer definitions do not move; only the ordering leaves the kernel. Reduce the kernel's database migration module to schema migration, removing its imports of legacy rename, migrate, and drop modules.

Move the legacy bootstrap module to `migrations/v10-rust` as `@ryot/v10-rust-migration`, carrying its documentation and agent guidance with it. It depends on `@ryot/kernel-backend` through the package export map. Do not add a hook, extension point, or plugin-shaped seam to the kernel for it; a generic seam whose only implementation is this migration would be a fiction.

Have `apps/server` sequence the kernel stages around the migration's two required phases, matching the current ordering: rename legacy tables, run schema migration, ingest system plugins, migrate legacy data, and drop legacy tables. The migration detects Rust V10 tables and no-ops when absent, so it stays safe on every boot of a TypeScript-native database. Preserve the migration-only mode and its script under `apps/server` so the legacy validation runbook of restoring a dump and running a migration-only process is unchanged.

Do not produce a separate migration image, tag, or operator-invoked command. Upgrading from Rust V10 remains an image tag change and the published migration guide continues to describe that flow. Do not revise migration scope, field mappings, deterministic identifiers, reporting behavior, restart safety, intentional omissions, or fail-fast rules; this task relocates code and inverts a dependency.

Remove the clauses in the kernel's agent guidance that name legacy bootstrap as the exception to normal write paths, because the exception no longer lives in the kernel, and restate them in the migration package's own guidance.

## Acceptance criteria

- [x] The kernel's composition module exports schema migration, system plugin ingestion, and runtime server stages separately.
- [x] The kernel's database migration module performs schema migration only and imports no migration mapping module.
- [x] `migrations/v10-rust` owns the legacy bootstrap code, its README, and its agent guidance, and depends on the kernel rather than the reverse.
- [x] `@ryot/kernel-backend` declares no dependency on `@ryot/v10-rust-migration`, and the kernel contains no hook or seam introduced for it.
- [x] `apps/server` sequences legacy table rename, schema migration, system plugin ingestion, legacy data migration and table removal, preserving current ordering.
- [x] Starting the server against a database with Rust V10 tables performs the migration automatically, and starting against a TypeScript-native database performs no migration work.
- [x] The migration-only mode and its script work from `apps/server`, and the documented dump-restore validation runbook is unchanged.
- [x] No separate migration image, tag, or operator command is introduced, and the published upgrade flow remains an image tag change.
- [x] Migration scope, mappings, deterministic identifiers, reporting, restart safety, and omissions are unchanged.
- [x] Repository check and test tasks pass.

## Implementation Notes

- Moved the legacy bootstrap sources unchanged to `migrations/v10-rust` as `@ryot/v10-rust-migration`. Its kernel imports now use the kernel package export map, and `apps/server` is the only package that depends on both workspaces.
- Reduced the kernel database migration module to Drizzle schema migration and exported schema migration, system plugin ingestion, and runtime server layers from the kernel composition module. The server now owns both normal and migration-only sequencing.
- Preserved the required working order of legacy table rename, Drizzle migration, system plugin ingestion, legacy data migration, and legacy table removal. This corrects the original task wording after confirming that data migration requires the active plugin loader snapshot described by the migration README.
- Removed the now-unused kernel purity allowlist and its matching and validation code. The purity scanner and the separate cycle and duplicate-layer checks remain for Task 05.
- Fixed existing server lint failures in the development restart loop and compiler-worker smoke output after they blocked the required server check; both changes preserve behavior.
- Verified all 29 moved migration TypeScript files have no non-import body changes, while the migration README and agent guidance are byte-identical. No restored V10 dump was available, so the documented dump-restore runbook was not rerun.
- `bun turbo --filter=@ryot/v10-rust-migration --filter=@ryot/kernel-backend --filter=@ryot/server check`, `bun turbo --filter=@ryot/kernel-backend test`, and `bun turbo --filter=@ryot/server build` pass. The affected end-to-end files `kernel/system/plugin-boot` and `kernel/plugins/system-plugin-reconciliation` pass together.
