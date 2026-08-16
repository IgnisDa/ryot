# Backups

Account export and restore use the deterministic `ryot-backup` version 1 archive. `archive/` owns the wire format, `export/` builds it, and `restore/` writes it into a clean account.

## Archive Contract

A backup is a non-Zip64 ZIP with entries in this order:

1. `manifest.json` at entry 0.
2. `profile.json`, then `private-plugins.ndjson`, `installations.ndjson`, `entities.ndjson`, `entity-dependencies.ndjson`, `relationships.ndjson`, `events.ndjson`, `saved-views.ndjson`, `integrations.ndjson`, and `notification-subscriptions.ndjson`.
3. Uncompressed content-addressed assets at `assets/<sha256>`.

The manifest contains `format: "ryot-backup"`, version 1, archive/application identity, creation time, redaction paths, required plugins, ordered section `{ path, count, sha256 }` records, and asset `{ path, size, sha256, contentType }` records. Other versions are rejected as unsupported. Export and restore use the same current archive schema and validate paths, digests, references, and ordering.

## Streaming

`events.ndjson` is the only usage-sized section and is a leaf: manifest construction, plugin resolution, and ID-remapping maps never depend on reading all events. Therefore:

- Export pages events into a temp file while incrementally counting and hashing; restore spools and inserts them in `RESTORE_EVENT_BATCH_SIZE` batches.
- No export or restore structure may be O(n) in event count. Duplicate event IDs are rejected by the database and mapped to `duplicate_record_id`, not tracked in memory.
- All bounded sections are encoded once in memory and reused for the ZIP entry.
- Assets and events are disk-backed; their limits bound disk and abuse. Metadata limits bound memory.

| Limit                       |   Value | Applies to                          |
| --------------------------- | ------: | ----------------------------------- |
| `maxEntryCount`             |   4,096 | ZIP central-directory work          |
| `maxRecordsPerSection`      | 250,000 | Bounded sections; events are exempt |
| `maxMetadataEntryBytes`     |  32 MiB | Manifest, profile, bounded sections |
| `maxEntryBytes`             | 256 MiB | Each asset or `events.ndjson`       |
| `maxTotalUncompressedBytes` |   1 GiB | Whole archive                       |

Export upload additionally allows 64 MiB for ZIP overhead.

## Export And Restore

The [kernel transaction invariant](../../../AGENTS.md#persistence) forbids transactions across network I/O. Export therefore creates a scoped temp directory, reads a single repeatable-read snapshot, spills events using database `ORDER BY id`, commits, then streams the archive to storage. Temp cleanup covers success, failure, and interruption.

Restore validation spools events and assets into the caller's scoped temp directory. It validates section order, counts, hashes, limits, required system packages, and private packages before writes. Private packages include compiled scripts and client artifacts; these are validated and collision-checked without server-side compilation. Assets are staged before the transaction so network work is outside it.

All database writes occur in one transaction: restore is atomic. Local event-file reads and batched inserts occur inside it. Temp deletion failure is logged and swallowed so it cannot turn a committed restore into a failed run.

Private packages and exact installation identities are restored without lifecycle dispatch. Complete installations retain archived disabled intent; missing redacted required secrets produce `needs-configuration`. Integrations missing required secrets are disabled. Integration and saved-view provenance resolve to the exact installation.

Client page compositions are derived from restored compiled artifacts and current runtime state. The archive contains custom views and only non-default built-in state overrides (or a selected built-in home), not copies of built-in content. Restore resolves built-ins from current definitions, rejects custom slug conflicts and missing definitions, then resolves installation home views by slug. The archive format version remains 1.

Source files are user-authored and may contain credentials, so they are not redacted. Only manifest configuration and integration settings fields may be redacted. Managed assets use content-addressed locators.

A restore target is clean only when every existing entity looks bootstrap-created: no provider, no external ID, and at most one such entity per entity schema, which is what a user-bootstrap ensure produces. Archived bootstrap entities match destination rows by schema and plugin ownership, never by name or initial properties. Every archived entity schema must exist in the current kernel or declared-plugin definition snapshot.

## Failure Contract

Expected archive, limit, and restore failures persist their module-owned kebab-case code and structured parameters on the run. They are not flattened to prose across workflow boundaries. Localized copy is client-owned and never persisted; unexpected causes and raw diagnostics remain in backend logs.
