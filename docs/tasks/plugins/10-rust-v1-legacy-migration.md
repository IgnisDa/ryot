# Rust V1 Legacy Migration

**Parent Plan:** [User-Owned Plugins](./README.md)

**Status:** done

## What to build

Adapt the implemented Rust V1 migration path to the final plugin and installation model. Follow the parent plan's Rust V1 Legacy Bootstrap decisions and preserve its existing domain mappings, S3 asset migration, integration-progress and YouTube Music cache migration, reporting, restart-safety, intentional omissions, and fail-fast rules. This task changes legacy mapping only after the ordinary runtime model is complete; it does not rebuild working migration phases.

Keep legacy table rename before final schema creation, ingest trusted system plugins before data resolution, then create media and fitness installations for migrated users before built-in views and integrations need them. Build one package-resolution context that supplies mapping modules with resolved system plugin, provider, schema, saved-view, integration-provider, and per-user installation identities. Do not run plugin user-bootstrap scripts because legacy mapping already creates equivalent data.

Rust V1 has no compatible private TypeScript package source. Do not synthesize private plugins or reinterpret legacy feature preferences as whole-plugin disablement.

## Acceptance criteria

- [x] Rust V1 table detection and rename still happen before the final TypeScript schema is created, without weakening migration restart safety.
- [x] Current media and fitness system plugins are ingested before legacy provider and definition resolution begins.
- [x] Every migrated user receives deterministic, ready media and fitness installation rows before installation-owned records are written.
- [x] Plugin user-bootstrap script dispatch remains disabled for migrated users, avoiding duplicate library or plugin-created data.
- [x] Legacy provider targets resolve by explicit trusted system plugin identity plus provider slug and fail on stale, missing, or ambiguous mappings.
- [x] Referenced provider entities remain global system-provider skeletons, custom entities remain user-owned, and existing intentional omissions remain unchanged.
- [x] Migrated integrations reference the owning user's media installation and validate against the current exact integration provider schema.
- [x] Media and fitness built-in saved views resolve through each user's system installations while legacy feature flags continue to control view disablement only.
- [x] Qualified plugin provenance is populated for migrated entities, events, relationships, views, signals, and other definition-backed rows as required by the final schema.
- [x] No private plugin package or unsupported plugin state is synthesized from Rust V1 data.
- [x] Migration reports retain progress and anomaly records, and every unexpected warning or unresolved plugin mapping fails migration.
- [x] Existing S3 assets retain owner-scoped content-addressed migration and property rewrites; documented old-object deletion failures remain nonfatal warnings.
- [x] Existing integration-progress and YouTube Music cache claims migrate with their current expiry and omission behavior using resolved final script and installation identities.
- [x] Legacy documentation describes the new identity resolution, installation ordering, preserved ownership, and intentional omissions.
- [x] Validation restores at least one normal and one larger available Rust V1 dump, runs migration-only mode, and inspects reports, counts, installations, integrations, views, and provider provenance.

## User stories addressed

- User story 51
- User story 52
- User story 53
- User story 54
- User story 55
- User story 56

## Implementor Notes

Follow the legacy module's runbook instead of adding ordinary unit tests. Keep set-based migration work in SQL and centralize identity resolution in TypeScript orchestration.

## Implementation Notes

- Added one package-resolution context for exact active media and fitness package IDs, qualified definitions, providers, integration providers, current scripts, and deterministic per-user installations.
- Threaded qualified schema provenance and exact installation identities through domain, saved-view, integration, and cache mappings. Integration settings are validated against the resolved current provider schema before insertion.
- Preserved bootstrap dispatch suppression, built-in view and notification bootstrap, provider/custom entity ownership, reports, S3 handling, cache expiry and omissions, and restart-safe writes.
- `tmp/file.sql` and `tmp/file2.sql` both completed migration-only mode through legacy-table removal. Report, count, installation, integration, saved-view, qualified-provenance, and provider-provenance checks passed; the only warnings were the documented unresolved episodic positions and S3 asset locators.
- `bun turbo --filter=@ryot/app-backend check` and `git diff --check` pass. Normal e2e does not exercise this migration path, so no e2e suite was run.
