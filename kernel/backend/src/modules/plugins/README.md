# Plugins

Plugins own package and installation state; `definitions` exposes their declarations and `scripts`
executes their code.

| Directory        | Owns                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| `packages/`      | Archive validation, ingestion, system package sync, and immutable revisions   |
| `installations/` | Per-user installation lifecycle and availability                              |
| `configuration/` | Encrypted execution configuration and its revisions                           |
| `preferences/`   | Non-secret per-user settings                                                  |
| `catalog/`       | Resolved availability, readiness, rate-limit policy, and catalog invalidation |
| `operations/`    | Product-facing plugin operation entrypoints                                   |

## Operation failures

`OperationsService` distinguishes a refusal from a crash. A script error whose boundary reason is
`operation-rejected` becomes HTTP 422 `PluginOperationRejected { message }`; every other sandbox
failure remains HTTP 502 `PluginInvocationError` with `runtime-failed`, because proxies may replace
502 bodies and the client treats them as transport failures.

## Repository composition

`packages/repository-layer.ts` owns `PluginRepositoryLive`, which provides the repository's client-artifact dependency. Automations planner, retention, and signal Layers use this focused composition without importing the plugins runtime Layer. Reusing the Layer preserves Effect's shared-resource composition.

## User plugin state

`user_plugin` and the plugin rows of `user_entity_schema` read `user_plugin_state`, one row per
installation whose availability, listing, definition effectiveness, and executability are stored
generated columns. Database triggers on `plugin_installation`, `plugin`, and `plugin_config_revision`
maintain it (`platform/db/user-plugin-state.ts`) because its inputs are written by the installation,
package, and configuration repositories, backup restore, raw-SQL one-time migrations, and foreign key
cascades; only triggers observe all of them.

`user_plugin.is_listed` includes hidden and installing installations, but excludes incompatible ones.
User-scoped provider listings read `user_sandbox_provider`. Catalog operations resolve one
`listPluginsAvailableToUser` snapshot and thread it through multi-row work rather than rereading
different catalog states or holding process-local catalog state.

## Plugin artifacts and revision identity

System archives and private uploads contain a manifest, compiled backend JavaScript artifacts, and
optional compiled client assets. Compiled backend metadata identifies each entry, format, and JavaScript
hash. Archives contain no authoring source files or compiled `script.source`. Ingestion validates
archive structure and artifact hashes without compiler workers or source-provenance proof; hashes
establish internal consistency only.

Plugin revisions have no source file table. Their `contentHash` fingerprints the manifest, exact compiled
backend entry/format/JavaScript, and exact compiled client content. It identifies package content, not
proof that the metadata was derived from authoring source.

`metadata.packageId` is the immutable authored `publisher/name` ID. Persisted local plugin IDs identify scope and
owner; installation IDs identify per-user lifecycle and settings. Display names are metadata and
may change without changing either identity. Revisions are immutable and keyed by their content
hash, not their version label.

System activation quarantines private installations claiming its exact package ID under the
ingestion lock. Their records, configuration, references, and data remain intact. Quarantine records
`package-identity-conflict`; removing the system package does not recover them automatically.
Explicit re-enable validates the retained archive, configuration, declarations, and dependencies
before clearing quarantine. Package updates validate the submitted archive and compatibility with
the retained revision. Normal compatible upgrades do not drain admitted work.

`isInitialized` records successful installation bootstrap separately from availability and visibility.
Quarantine and ordinary revision changes preserve it. Explicit recovery of a completed installation
does not reseed it; incomplete recovery uses a fresh private activation token and the existing
installation workflow. Guarded lifecycle completion sets readiness and initialization together.

## System plugin synchronization

`PluginIngestionService` owns system plugin ingestion and environment configuration
resolution. Interactive installation resolves the installed plugin's environment
configuration in its ingestion transaction.

Boot uses `synchronizeSystemPlugins` to ingest all bundled sources with environment
resolution deferred. After ingestion completes, the service takes the ingestion lock
and resolves environment configuration once for every active system plugin. This bulk
pass includes plugins that are active but are not bundled by the current server build.

Callers must not add a separate boot-time environment resolution pass.

System config uses `RYOT_PLUGIN__<PUBLISHER>__<NAME>__<NORMALIZED_KEY>`, with package ID segments uppercased and `-` replaced by `_`.
Private config never reads environment values. All replicas must use the same server release and
deployment configuration; the persisted catalog is authoritative and ingestion is serialized.

Boot resolution sets `plugin.environment_config_revision_id` under the ingestion lock; all nodes
must share environment values because the last booting node wins. Installation configuration pointer
activation uses the same ingestion lock. Retained executions use exact revision/configuration pins,
not current environment values. Automation hooks use stable plugin ID and authored hook slug;
scripts resolve by immutable revision ID, script slug, and content hash.

Ingestion readiness uses configured-key metadata from the exact revision and configuration owner,
without decrypting values. It checks availability, not ciphertext authentication. Startup validates
retained encryption-key references; execution configuration reads still authenticate ciphertext.

## User preferences

`userSettingsSchema` declares non-secret per-user preferences. `plugin_installation.user_settings`
stores explicit choices, while schema defaults supply missing values. `PluginUserSettingsWriter` owns
every write: it validates against the active persisted schema, caps the stored document at 64 KiB,
locks asset references, and invalidates the user's catalog after commit. Installation-owned saves and
resets replace the document under the exclusive ingestion lock. The `updateUserSettings` sandbox call
merges top-level keys under the shared ingestion lock and the user write lock, after admitting the
subject's account generation. It resolves the installation from the plugin and execution user,
accepts only keys in the pinned revision's schema, and rejects uninstalled, inactive, or incompatible
installations at write time. Each patch invalidates the catalog; the four-call execution cap bounds
that cost. RyotQL exposes stored choices to the kernel preferences UI. Sandbox reads resolve the
execution user and plugin identity, applying the pinned revision's schema and defaults. These
preferences remain separate from encrypted configuration revisions and their redacted client
projections.

## Ingestion retirement

Uninstall commits an installation admission fence under the user write lock, then delegates
ingestion interruption, reconciliation, and payload/pin cleanup to the imports owner outside
the transaction. Only after cleanup does it tombstone the installation and record the uninstall
receipt. Retrying an interrupted uninstall retains the same fence and cleanup owners.
