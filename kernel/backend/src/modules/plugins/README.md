# Plugins

## Repository composition

`repository-layer.ts` owns `PluginRepositoryLive`, which provides the repository's client-artifact dependency. Automations planner, retention, and signal Layers use this focused composition without importing the plugins runtime Layer. Reusing the Layer preserves Effect's shared-resource composition.

## Plugin artifacts and revision identity

System archives and private uploads contain a manifest, compiled backend JavaScript artifacts, and
optional compiled client assets. Compiled backend metadata identifies each entry, format, and JavaScript
hash. Archives contain no authoring source files or compiled `script.source`. Ingestion validates
archive structure and artifact hashes without compiler workers or source-provenance proof; hashes
establish internal consistency only.

Plugin revisions have no source file table. Their `sourceHash` fingerprints the manifest, exact compiled
backend entry/format/JavaScript, and exact compiled client content. It identifies package content, not
proof that the metadata was derived from authoring source.

## System plugin synchronization

`PluginIngestionService` owns system plugin ingestion and environment configuration
resolution. Interactive installation resolves the installed plugin's environment
configuration in its ingestion transaction.

Boot uses `synchronizeSystemPlugins` to ingest all bundled sources with environment
resolution deferred. After ingestion completes, the service takes the ingestion lock
and resolves environment configuration once for every active system plugin. This bulk
pass includes plugins that are active but are not bundled by the current server build.

Callers must not add a separate boot-time environment resolution pass.

## User preferences

`userSettingsSchema` declares non-secret per-user preferences. `plugin_installation.user_settings`
stores explicit choices, while schema defaults supply missing values. Installation-owned saves and
resets validate the active persisted schema under the ingestion lock and invalidate the user's catalog.
RyotQL exposes stored choices to the kernel preferences UI. Sandbox reads resolve the execution user
and plugin identity, applying the pinned revision's schema and defaults. These preferences remain
separate from encrypted configuration revisions and their redacted client projections.

## Ingestion retirement

Uninstall commits an installation admission fence under the user write lock, then delegates
ingestion interruption, reconciliation, and payload/pin cleanup to the imports owner outside
the transaction. Only after cleanup does it tombstone the installation and record the uninstall
receipt. Retrying an interrupted uninstall retains the same fence and cleanup owners.
