# Backups

Account export and restore use the deterministic `ryot-backup` version 1 archive. `archive/` owns the wire format, `export/` builds it, and `restore/` writes it into a clean account.

Creating a run queues its `backup-export` or `backup-restore` [job](../../platform/jobs/README.md) in the same transaction. A failed step settles the run as failed; only a lost process retries the job, and its idempotent steps resume the run.

## Archive Contract

A backup is a non-Zip64 ZIP with entries in this order:

1. `manifest.json` at entry 0.
2. `profile.json`, then `private-plugins.ndjson`, `installations.ndjson`, `entities.ndjson`, `entity-dependencies.ndjson`, `relationships.ndjson`, `events.ndjson`, `pages.ndjson`, `saved-views.ndjson`, `calendar-source-overrides.ndjson`, `integrations.ndjson`, `notification-subscriptions.ndjson`, `reminders.ndjson`, `publications.ndjson`, `fold-values.ndjson`, and `assistant.ndjson`.
3. Uncompressed content-addressed assets at `assets/<sha256>` and generic binary blobs at `blobs/<sha256>`.

The manifest contains `format: "ryot-backup"`, version 1, archive/application identity, creation time, redaction paths, required plugins, ordered section `{ path, count, sha256 }` records, and asset and binary blob `{ path, size, sha256, contentType }` records. Other versions are rejected as unsupported. Export and restore use the same current archive schema and validate paths, digests, references, and ordering.

`profile.json` contains complete canonical user preferences. Export decodes the stored value; archive validation and historical restore reject malformed or incomplete preferences instead of filling missing fields.

Shared dependencies use explicit `provider-reference`, `bootstrap-reference`, and `snapshot` records.
References contain archive-local IDs, exact package/schema ownership, stable provider or bootstrap
identity, and a fallback name. Provider references are limited to provider roots. A provider child's
external ID alone does not establish a safe reconstruction route, so such children retain portable
snapshots. Non-reconstructible unmanaged dependencies also retain snapshots. Source database IDs
never select destination rows. Generated translation overlays, properties/assets belonging only
to compact references, and events declared as transient user-state evidence are omitted.

The timezone preference is restored like any other preference. The zone chosen at account creation
does not make a restore target unclean; the archived preference replaces it. Other non-default
account preferences still make the target unclean.

## Streaming

Every usage-sized NDJSON section is disk-backed: entities, dependencies, relationships, events,
pages, saved views, calendar overrides, integrations, subscriptions, reminders, publications and assistant history. Export uses stable
keyset pages and incrementally counts and hashes each spool. ZIP entry streams open on demand and
advance under storage backpressure. Profile, private packages, installations, and the manifest retain
strict metadata limits.

Dependency discovery uses set-based, owner-bound queries and schema-declared reference paths,
including nested object/array fields. Decrypted installation configuration and preferences are
bounded metadata inputs. Snapshot dependencies are discovered through an indexed pending set until
the dependency closure is complete; ordinary string fields are never treated as references.

Run-scoped PostgreSQL staging tables own growing ID sets, duplicate detection, reference edges,
and destination mappings. Restore validates all streamed sections before account writes, allocates
mappings before rewriting forward references or cycles, and retains only the current page and its
referenced identities in application memory. Staged record pages are bounded by both count and
uncompressed JSON bytes; PostgreSQL compression cannot bypass the byte bound. Scope finalizers clean
staging on success, failure, and interruption. Retried runs replace their staging, and recovery
removes expired or terminal-run staging.

- Every NDJSON record is limited to 4 MiB of UTF-8 JSON, excluding its newline. The decoder checks
  bytes before buffering, including incomplete lines, and reuses a bounded buffer across records.
  Manifest and profile entries retain their separate metadata limit.

| Limit                       |   Value | Applies to                                         |
| --------------------------- | ------: | -------------------------------------------------- |
| `maxEntryCount`             |   4,096 | ZIP central-directory work                         |
| `maxPluginRecords`          |     256 | Private packages, installations, required packages |
| `maxRecordsPerSection`      | 250,000 | Bounded metadata sections                          |
| `maxMetadataEntryBytes`     |  32 MiB | Manifest, profile, bounded sections                |
| `ARCHIVE_MAX_RECORD_BYTES`  |   4 MiB | Each NDJSON record                                 |
| `maxEntryBytes`             | 256 MiB | Each asset or streamed section                     |
| `maxTotalUncompressedBytes` |   1 GiB | Whole archive                                      |

Export upload additionally allows 64 MiB for ZIP overhead.

Section preparation and validation log record counts and byte sizes. Size-limit errors carry the
entry path, measured bytes, and permitted bytes. Export preserves these archive failures even when
the storage writer replaces its input-stream error with an upload failure. Asset objects open only
when the ZIP writer reaches their entry, not when the asset list is assembled.

## Export And Restore

The [kernel transaction invariant](../../../AGENTS.md) forbids transactions across network I/O.
Export creates scoped temporary files and run-scoped staging, reads one repeatable-read snapshot,
spills record pages, commits, and only then streams the ZIP and assets to object storage. The snapshot
transaction writes only backup staging, not account data.

Restore validation spools all record sections and assets into the caller's scoped temp directory. It validates section order, counts, hashes, limits, declared ownership, typed references, required system packages, and private packages before account writes. Package keys encode scope and `publisher/name` package ID; names and slugs are metadata. Private packages include a manifest, compiled scripts, and the package-bound compiled-client artifact with its fingerprint; they include no authoring source. Assets are staged before the transaction so network work is outside it.

System requirements contain a definition contract derived from the manifest schemas. Restore binds only a matching destination system package. A compatible revision can satisfy the requirement after contract and restored-value validation. Missing or incompatible packages fail preflight. Account restore never installs system code or changes a system revision, environment configuration, or shared global entity that already exists. Private records cannot request global scope.

User-owned entity records may carry provider provenance only from a private plugin. System-provider
entities belong in global entity dependencies; preflight rejects them in the user-owned section.

Historical writes and run completion occur in the same database transaction: restore is atomic.
Validated staged pages are inserted inside it. Replay uses completed status, not display progress.
A transaction failure rereads that status before retrying or reporting failure, so a lost commit
acknowledgement does not repeat committed writes. Temporary upload deletion is best effort after
completion; deletion failure is logged and swallowed.

Restore never calls providers. Missing reference targets are reserved with destination-local IDs,
the verified schema/provider identity, a fallback name, empty properties, and `populatedAt: null`.
This is an unpopulated entity, not schema-complete metadata. Natural-identity conflicts reuse the
destination row without overwriting its metadata. Normal foreground enrichment supplies later
population with the existing admission, concurrency, and retry controls; restore creates no refresh
fan-out. Snapshot metadata is applied only to rows allocated by this restore.

Event archives contain source rows and their schema-backed properties, including the events folds
wrote. Restore remaps typed references, drops [event references](../events/README.md#event-references)
whose event is not in the archive, and queues a `fold-rebuild` job for each restored plugin, in the
data transaction, instead of trusting archived calculations; completed restore does not mean completed
folds. Unavailable plugins, configuration and artifacts do not gain authority or become ready through
restore.

`fold-values.ndjson` carries each subject's fold value, which only the plugin can read. Restore stores it
as an `absorbed` row with a map of every archived entity and event ID it found in the value, alone or
as a segment of a colon-separated string. The rebuild hands both to the fold, so what the plugin remembers
beyond its events survives, and a merge moves a value the same way.

After the complete event stream is inserted, restore checks declared event-group consistency with
set-based SQL. It does not load account history into memory or recapture immutable recorded properties
from current metadata. An inconsistent group rolls back the restore as an invalid event archive entry.

`restore/writer.ts` validates and maps archive records; `restore/persistence.ts` owns historical inserts, updates, installation config revisions, and client projections. Ordinary repositories expose runtime writes and backup reads, not historical restore writes. Both the restore writer and its persistence layer use the active database session inside the restore's transaction.

`export/repository.ts` reads stored built-in overrides independently of executable saved-view catalogs. Export uses the retained private manifest to keep quarantined view state without exposing its client code.

Export, restore, and Data import share property-reference and managed-asset handling from
`data-references.ts`. Archive values reuse the data JSON property and timestamp codecs. Archive schema ownership uses scoped package keys, not source-local database IDs.

Private packages and installation identities are mapped to destination-local records without lifecycle dispatch. Hidden intent and incompatible health are distinct. Exported quarantine remains incompatible even when its former system conflict is absent. A private package that conflicts with a destination system identity is retained privately with `package-identity-conflict`; its data never binds to the system owner. Missing redacted required secrets produce `needs-configuration`. Integrations missing required secrets are disabled. Private configuration never falls back to environment values.

Installation records require `isInitialized`, the persisted completion marker from the installation/bootstrap lifecycle. Export and restore preserve it independently of health, quarantine, and hidden intent. A completed installation can skip bootstrap during explicit validated recovery; an incomplete quarantined installation remains uninitialized and uses the existing workflow with a fresh activation token. Account restore does not run bootstrap or infer completion from archived data. Archives missing this field are rejected.

Each installation is identified only by its scoped package key, and installation records sort by that key. Custom view workspace associations and integration owners reference this key directly; null means an unassociated view or a kernel integration. Renderer ownership is independent of workspace association. Duplicate installation keys and references to missing installations are rejected. Installation configuration redaction paths use the JSON Pointer-escaped package key. One map binds these keys to destination installation IDs, reusing existing system installations without replacing environment configuration.

Bounded metadata maps bind package keys to destination plugins and installations. Indexed staging
binds record IDs, including custom saved views and reminder replacements. Events use deterministic
destination-user-scoped IDs with indexed duplicate detection. Providers, sessions, integrations,
subscriptions, renderer owners, workspace associations, home references, and built-in overrides keep
their exact ownership. Only typed query plugin references and the known renderer schema-reference
codec remap plugin ownership. Ordinary query literals and opaque plugin JSON remain unchanged.

Installation records include per-user plugin preferences as JSON. Plugin manifest settings schemas forbid secret fields, so these preferences are included as non-secret data and validated against the active manifest during restore. The archive format version remains 1.

Calendar source overrides carry the exact owner package key, source slug, and hidden state. Export skips an override whose source no longer resolves to a current or retained definition, so stale state never blocks a backup. Restore maps the package key like built-in view overrides and rejects an override whose restored definition is unavailable. An existing override makes the destination account unclean.

Authored pages are a required streamed `pages.ndjson` section, including pages that have only a draft.
Records retain draft and published definitions, definition revisions, authority revision, origin,
write access, names and timestamps. Definitions reuse the page contract codecs. Only typed query
plugin identities become scoped package references; source files, base64 assets and ordinary query
literal values remain opaque. Restore recomputes definition hashes after mapping query owners.

Published artifact metadata carries its page kind, versions, hash, portable declaration identity,
imports and file descriptors. File bytes use content-addressed `blobs/` entries, streamed and spooled
through the same bounded binary machinery as assets; an 8 MiB client artifact never becomes a
base64 NDJSON record or requires increasing the 4 MiB record limit. Archive validation verifies
binary sizes and digests. Page preflight verifies artifact kind, supported versions, file names,
MIME types, byte limits, imports, declaration identity and the owning package's content hash.

Restore allocates page IDs before rewriting saved-view renderers and inserts pages and immutable
published artifacts through backup-owned historical persistence inside the restore transaction.
It never invokes the compiler. Draft preview artifacts and their compiled-revision markers,
derived composition rows and capability grants are omitted. Live composition is derived afresh;
snapshot composition uses its captured graph. Any page,
including an unpublished draft, makes a destination account unclean. Publications reference the
restored page identities.

Client page compositions are derived from restored compiled artifacts and current runtime state. The archive contains custom views and only non-default built-in state overrides (or a selected built-in home), not copies of built-in content. Built-ins use exact owner plus local slug; custom views have their own namespace. Homes use tagged custom, kernel, or plugin references. The archive format version remains 1.

Private plugin backups contain no authoring source. Manifest configuration, integration settings and the user assistant provider key may be redacted. Managed assets use content-addressed locators.

Account restore retains user-owned canonical data, relationships, event facts, and required snapshot
dependencies. Enrichment requests, generated translations, and job and workflow state are not exported.
Snapshot translation overlays supplied by an archive bind their source generation to the destination
entity's current canonical generation. Dependencies have no related-completion stamp; foreground
interest rechecks them lazily. The archive version remains 1.

A restore target is clean only when every existing entity looks bootstrap-created: no provider, no external ID, and at most one such entity per entity schema, which is what a user-bootstrap ensure produces. Archived bootstrap entities match destination rows by schema and plugin ownership, never by name or initial properties. Every archived entity schema must exist in the current kernel or declared-plugin definition snapshot.

Restore-target inspection uses existence and grouped queries for growing collections; it does not
load their properties. Reminder removal fences also make a target unclean. Saved-view and
subscription comparisons read at most their definition count plus one. Installation inspection
reads at most 4,097 rows and rejects a target with more than 4,096 installations.

Reminder records are a required streamed section in the current archive. Export includes reminder-only global
targets and parent scopes as dependencies. Restore remaps targets, parents and replacement links.
Unfinished records become `needs-scheduling`, with no active instant, formatter, trigger, dispatch or
delivery claim. Original date/time values remain, including whether a Processing source may have
sent. Settled/cancelled outcomes remain history. Existing reminders make an account unclean, including
retained removal fences. Channels and delivery ledgers are not portable and are never restored.

Publication records carry active publication details, the page reference, owner-bound arguments,
and live or snapshot mode. The archived query declaration supplies argument reference metadata;
restore verifies live declarations against the archived page and validates partial owner bindings.
Encoded collection, custom-view and plugin-view arguments reuse saved-argument reference handling.
Only schema-declared IDs are remapped. Ordinary strings and captured query result IDs remain frozen.
Live publications follow the restored page's current published definition. Export omits live
publications whose bound collection or custom/built-in view no longer exists, including encoded
entity-source arguments. Frozen snapshots remain independent of source existence.

Snapshots retain the captured page definition, name and revisions, fully bound capture arguments,
settings and first-page query results. Captured managed locators are collected independently of
source rows and rewritten through content-addressed assets, so deleting a source does not discard
its captured assets. Missing historical argument targets remain inert captured values; references
with archived targets are remapped. Snapshot documents are never executed during restore.

The captured artifact has its own metadata and blob entries, independent of the page's current
published artifact. Both survive when they differ. Restore validates and persists the captured
artifact using the page artifact machinery, with no compiler. Captured composition identities,
runtime entries, and all dependency/kernel/runtime artifact metadata and blob bytes are also retained
independently of current plugin artifacts. Restore reconstructs these generic artifacts without
compilation and remaps composition page and plugin bindings; it never resolves current exports.
Captured definition hashes are recomputed after mapping typed query owners. Publication links and visitor sessions are omitted;
restored publications start active at revision 1 with no links. Existing publications, including
revoked ones, make an account unclean.

## Failure Contract

Expected archive, limit, and restore failures persist their module-owned kebab-case code and structured parameters on the run. They are not flattened to prose across job boundaries. Localized copy is client-owned and never persisted; unexpected causes and raw diagnostics remain in backend logs.

Custom saved views carry authored parameterized documents, normalized saved arguments, filters and
sort choices. Export discovers typed argument dependencies with set-based reads. Restore stages
argument reference edges, remaps entity/event/relationship IDs and tagged collection/custom/plugin
source references from schema metadata, then regenerates browser-derived queries and validates all
stored branches and controls. Ordinary strings and opaque JSON remain unchanged. Source references
and growing ID mappings are processed one bounded staging page at a time.

## Assistant history

`assistant.ndjson` is a required streamed section containing tagged conversation, turn, tool-call,
message and user-provider records. Export traverses each owner-bound table by primary-key cursor,
one row at a time, independently of runtime history pagination. The shared record/entry limits and
spool backpressure apply. Restore stages composite kind/ID identities and reference edges on disk,
allocates destination identities before rewriting, and writes in conversation/turn/call/message order.
Text, tool names, pinned capabilities, opaque arguments and opaque results retain their historical
values. Only typed conversation, turn, message, call (including a capability call's parent) and
inline preview page references change identity. A capability call's parent must be a model tool
call in the same turn.

Queued, running and awaiting-approval turns become interrupted history. Every unfinished call gains
an inert `{ interrupted: true }` result, including approved and undecided calls; existing decisions
and completed results remain intact. No assistant workflows, wakes or execution authority are
created. Draft preview page IDs are remapped, but compiled draft markers/artifacts remain omitted;
the preview host reports these historical previews as unavailable and the user must prepare them
again. Previews of deleted pages become explicit unavailable text.

Only user provider URL/model configuration is exported. Key presence is recorded and
`/assistant/provider/apiKey` appears in manifest redactions when applicable; plaintext, ciphertext,
encryption attribution and instance provider configuration never enter the archive. Backups offer
no secret-inclusive option. Restored user overrides have no key: re-enter it in Settings → Ryo
before using an authenticated provider. The override remains selected rather than silently using
instance credentials. Assistant history or any provider override makes the destination unclean.

## Memory regression coverage

`streaming-memory.test.ts` starts a dedicated workload process for each dataset size (1,000 and
5,000 entities, with relationships, events and reminders). Each process owns a fresh schema, runs
with live time, and checks restored references and staging cleanup. The 512 MiB lifetime peak-RSS
budget includes module loading, service setup, SQL fixture seeding, export, validation and restore.
Phase diagnostics are captured and included in failures. No forced GC or retry changes the gate.
The two sizes exercise bounded memory as the record count grows; they do not establish a universal
memory bound for every allowed input. Archive decoder limits and restore batch tests provide the
corresponding deterministic boundary coverage.

Linux CI runs `bun turbo --filter=@ryot-app/kernel-backend test:memory` after the backend suite.
This repeats both sizes three times with seed 42; every execution must pass.
