# Plugins

## Repository composition

`repository-layer.ts` owns `PluginRepositoryLive`, which provides the repository's client-artifact dependency. Automations planner, retention, and signal Layers use this focused composition without importing the plugins runtime Layer. Reusing the Layer preserves Effect's shared-resource composition.

## System plugin synchronization

`PluginIngestionService` owns system plugin ingestion and environment configuration
resolution. Interactive installation resolves the installed plugin's environment
configuration in its ingestion transaction.

Boot uses `synchronizeSystemPlugins` to ingest all bundled sources with environment
resolution deferred. After ingestion completes, the service takes the ingestion lock
and resolves environment configuration once for every active system plugin. This bulk
pass includes plugins that are active but are not bundled by the current server build.

Callers must not add a separate boot-time environment resolution pass.
