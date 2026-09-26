# Plugins

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
