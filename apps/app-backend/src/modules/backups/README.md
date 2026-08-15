# Backups

Account export and restore for the V2 archive format. `archive-v2/` owns the wire format, `export/`
builds archives, and `restore/` writes them back into a clean account.

## Archive layout

A backup is a deterministic, non-Zip64 ZIP whose entries appear in a fixed order:

1. `manifest.json` — format version, archive identity, redaction paths, required plugins, one
   `{path, count, sha256}` entry per section in `V2_SECTION_PATHS` order, and one
   `{path, size, sha256, contentType}` entry per asset.
2. `profile.json` and the eight NDJSON sections, in `V2_SECTION_PATHS` order.
3. `assets/<sha256>` — content-addressed managed asset bytes, stored uncompressed.

`manifest.json` is entry 0 and carries each section's digest and record count, so both sides know a
section's identity before its bytes are read.

## The streaming invariant

`events` is the only section whose size grows with usage history; every other section is bounded by
catalog size. It is also a pure leaf: nothing reads events to build the manifest, resolve required
plugins, or populate the entity/relationship id-remapping maps. That combination is what makes it
safe to treat events differently from everything else, and it is the invariant the whole design
rests on:

- **Events are disk-backed at every stage.** On export they are spilled page by page to a temp file;
  on restore the extractor spools `events.ndjson` to disk exactly like an asset and the writer
  streams it back in insert batches. Neither direction ever holds the full section in memory.
- **Everything else stays in memory.** Bounded sections are encoded once into a `Uint8Array` that
  is measured for the manifest and then reused as the ZIP entry, so each record is encoded a single
  time.
- **No structure may be O(n) in events.** This is why `createV2Archive` does not build a `Set` of
  event ids: `event.id` is the primary key, so restore relies on the insert to reject duplicates and
  maps the unique violation to a `duplicate_record_id` archive error. Peak memory on both paths must
  stay independent of event count.

The export spill computes the section's count and digest before the ZIP is written. `V2Manifest`,
`V2_SECTION_PATHS`, and `V2ArchiveRecords` keep events outside the in-memory record collection.

## Limits

`V2_ARCHIVE_LIMITS` mixes guards with different jobs; each one covers exactly one class of entry.

| Limit                       | Applies to                                                              | Why                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `maxEntryCount`             | every ZIP entry                                                         | Bounds central-directory work on read.                                                                                    |
| `maxRecordsPerSection`      | bounded sections only                                                   | A catalog-sized section that large is a corrupt or hostile archive. Events are exempt — their size is legitimate history. |
| `maxMetadataEntryBytes`     | RAM-buffered entries: `manifest.json`, `profile.json`, bounded sections | These are fully materialized, so the cap is a memory guard.                                                               |
| `maxEntryBytes`             | disk-backed entries: assets and `events.ndjson`                         | These stream to and from disk, so the cap is a disk/abuse guard, not a memory one.                                        |
| `maxTotalUncompressedBytes` | whole archive                                                           | `MAX_ARCHIVE_BYTES` in `export/workflow.ts` tracks it plus ZIP overhead.                                                  |

## Export sequencing

`apps/app-backend/CLAUDE.md` forbids holding a transaction across network calls, so events cannot be
streamed straight to object storage from inside the snapshot transaction. The export therefore
splits into spill-then-upload:

1. `ExportBackupWorkflowOperations.build` acquires a scoped temp directory under
   `config.fileStorage.localTempDir` (`FILE_STORAGE_LOCAL_TEMP_DIR`). The scope removes it on
   success and on every failure path.
2. Inside one repeatable-read read-only transaction, `prepareExportSnapshot` reads the bounded
   sections, then pages the event table twice: once to collect managed asset locators (bounded by
   asset count, not event count), and once to redact, rewrite asset locators, encode NDJSON, append
   to the temp file, and update an `IncrementalSha256`. Both passes do database reads and local disk
   writes only, so the transaction rule holds.
3. After the transaction commits, the archive stream reads the spill file back as the
   `events.ndjson` entry and uploads the ZIP.

Event ordering comes from the database's `ORDER BY id` rather than a JavaScript `localeCompare`
sort. Nothing on the read path depends on event order.

## Restore sequencing

Private packages and exact system requirements are validated before asset staging. Private packages
are compiled and collision-checked before the write transaction. Asset staging happens before the
transaction, so no network call is held inside it. The write itself
stays in a single transaction — atomicity is the point of a restore, and the cost that used to hurt
was per-row round trips, not transaction size. Reading the spilled `events.ndjson` from local disk
inside the transaction is rule-compliant. Events are inserted `RESTORE_EVENT_BATCH_SIZE` rows per
statement; per-event reference rewriting and property validation stay per-event.

Restore persists private packages and installation identities without lifecycle dispatch. The rows
remain unavailable until commit. Complete installations become ready with their archived disabled
intent; installations missing redacted required secrets become `needs-configuration`. Integration
rows and plugin-scoped custom saved views retain package-key provenance that restores to the exact
installation. Integrations missing required secrets are restored disabled. Source files are
user-authored data and may contain credentials; only manifest config and integration settings fields
can be redacted.

User-bootstrap entity creation persists its origin on the entity and in the archive. A restore target
is clean only when every existing entity has bootstrap origin. Archived bootstrap entities are matched
to those destination rows by entity schema and plugin ownership; the restore does not depend on a
specific plugin, schema slug, entity name, or initial properties.

## Error fidelity

Both workflows persist structured failure data for the run row. Expected archive and restore
failures retain the owning module's kebab-case reason code and structured parameters; they are not
flattened into a generic error or prose message. Archive limit breaches remain typed failures so
their reason and parameters survive the workflow boundary.

Localized copy is owned by clients and is never persisted. Unexpected causes stay in backend logs;
raw compiler/runtime diagnostics do not become workflow failure text.
