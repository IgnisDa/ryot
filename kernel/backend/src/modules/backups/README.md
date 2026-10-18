# Backups

Account export and restore use the deterministic `ryot-backup` version 1 archive. `archive/` owns the wire format, `export/` builds it, and `restore/` writes it into a clean account.

## Archive Contract

A backup is a non-Zip64 ZIP with entries in this order:

1. `manifest.json` at entry 0.
2. `profile.json`, then `private-plugins.ndjson`, `installations.ndjson`, `entities.ndjson`, `entity-dependencies.ndjson`, `relationships.ndjson`, `events.ndjson`, `saved-views.ndjson`, `calendar-source-overrides.ndjson`, `integrations.ndjson`, and `notification-subscriptions.ndjson`.
3. Uncompressed content-addressed assets at `assets/<sha256>`.

The manifest contains `format: "ryot-backup"`, version 1, archive/application identity, creation time, redaction paths, required plugins, ordered section `{ path, count, sha256 }` records, and asset `{ path, size, sha256, contentType }` records. Other versions are rejected as unsupported. Export and restore use the same current archive schema and validate paths, digests, references, and ordering.

`profile.json` contains complete canonical user preferences. Export decodes the stored value; archive validation and historical restore reject malformed or incomplete preferences instead of filling missing fields.

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

The [kernel transaction invariant](../../../AGENTS.md) forbids transactions across network I/O. Export therefore creates a scoped temp directory, reads a single repeatable-read snapshot, spills events using database `ORDER BY id`, commits, then streams the archive to storage. Temp cleanup covers success, failure, and interruption.

Restore validation spools events and assets into the caller's scoped temp directory. It validates section order, counts, hashes, limits, declared ownership, typed references, required system packages, and private packages before account writes. Package keys encode scope and `publisher/name` package ID; names and slugs are metadata. Private packages include a manifest, compiled scripts, and the package-bound compiled-client artifact with its fingerprint; they include no authoring source. Assets are staged before the transaction so network work is outside it.

System requirements contain a definition contract derived from the manifest schemas. Restore binds only a matching destination system package. A compatible revision can satisfy the requirement after contract and restored-value validation. Missing or incompatible packages fail preflight. Account restore never installs system code or changes a system revision, environment configuration, or shared global entity that already exists. Private records cannot request global scope.

User-owned entity records may carry provider provenance only from a private plugin. System-provider
entities belong in global entity dependencies; preflight rejects them in the user-owned section.

Historical writes and run completion occur in the same database transaction: restore is atomic. Local event-file reads and batched inserts occur inside it. Replay uses completed status, not display progress. A transaction failure rereads that status before retrying or reporting failure, so a lost commit acknowledgement does not repeat committed writes. Temporary upload deletion is best effort after completion; deletion failure is logged and swallowed.

`restore/writer.ts` validates and maps archive records; `restore/persistence.ts` owns historical inserts, updates, installation config revisions, and client projections. Ordinary repositories expose runtime writes and backup reads, not historical restore writes. Both the restore writer and its persistence layer use the active database session inside the workflow's transaction.

`export/repository.ts` reads stored built-in overrides independently of executable saved-view catalogs. Export uses the retained private manifest to keep quarantined view state without exposing its client code.

Export, restore, and Data import share property-reference and managed-asset handling from
`data-references.ts`. Archive values reuse the data JSON property and timestamp codecs. Archive schema ownership uses scoped package keys, not source-local database IDs.

Private packages and installation identities are mapped to destination-local records without lifecycle dispatch. Hidden intent and incompatible health are distinct. Exported quarantine remains incompatible even when its former system conflict is absent. A private package that conflicts with a destination system identity is retained privately with `package-identity-conflict`; its data never binds to the system owner. Missing redacted required secrets produce `needs-configuration`. Integrations missing required secrets are disabled. Private configuration never falls back to environment values.

Installation records require `isInitialized`, the persisted completion marker from the installation/bootstrap lifecycle. Export and restore preserve it independently of health, quarantine, and hidden intent. A completed installation can skip bootstrap during explicit validated recovery; an incomplete quarantined installation remains uninitialized and uses the existing workflow with a fresh activation token. Account restore does not run bootstrap or infer completion from archived data. Archives missing this field are rejected.

Each installation is identified only by its scoped package key, and installation records sort by that key. Custom view workspace associations and integration owners reference this key directly; null means an unassociated view or a kernel integration. Renderer ownership is independent of workspace association. Duplicate installation keys and references to missing installations are rejected. Installation configuration redaction paths use the JSON Pointer-escaped package key. One map binds these keys to destination installation IDs, reusing existing system installations without replacing environment configuration.

Explicit maps also bind package keys to plugins, entity IDs, relationship IDs, and custom saved-view IDs. Events retain duplicate detection through deterministic destination-user-scoped IDs without an event-count-sized map. Providers, sessions, integrations, subscriptions, renderer owners, workspace associations, home references, and built-in overrides keep their exact ownership. Only typed query plugin references and the known renderer schema-reference codec remap plugin ownership. Ordinary query literals and opaque plugin JSON remain unchanged.

Installation records include per-user plugin preferences as JSON. Plugin manifest settings schemas forbid secret fields, so these preferences are included as non-secret data and validated against the active manifest during restore. The archive format version remains 1.

Calendar source overrides carry the exact owner package key, source slug, and hidden state. Export skips an override whose source no longer resolves to a current or retained definition, so stale state never blocks a backup. Restore maps the package key like built-in view overrides and rejects an override whose restored definition is unavailable. An existing override makes the destination account unclean.

Client page compositions are derived from restored compiled artifacts and current runtime state. The archive contains custom views and only non-default built-in state overrides (or a selected built-in home), not copies of built-in content. Built-ins use exact owner plus local slug; custom views have their own namespace. Homes use tagged custom, kernel, or plugin references. The archive format version remains 1.

Private plugin backups contain no authoring source. Only manifest configuration and integration settings fields may be redacted. Managed assets use content-addressed locators.

Account restore retains canonical entity data, relationships, and translation overlays, but enrichment request and workflow state is runtime state and is not included. Restored translation overlays bind their `sourceContentGeneration` to the destination entity's current canonical content generation, so restore does not carry a source generation from another database. Restored dependencies have no related-completion stamp; foreground interest rechecks them lazily. The archive version and layout are unchanged.

A restore target is clean only when every existing entity looks bootstrap-created: no provider, no external ID, and at most one such entity per entity schema, which is what a user-bootstrap ensure produces. Archived bootstrap entities match destination rows by schema and plugin ownership, never by name or initial properties. Every archived entity schema must exist in the current kernel or declared-plugin definition snapshot.

## Failure Contract

Expected archive, limit, and restore failures persist their module-owned kebab-case code and structured parameters on the run. They are not flattened to prose across workflow boundaries. Localized copy is client-owned and never persisted; unexpected causes and raw diagnostics remain in backend logs.
