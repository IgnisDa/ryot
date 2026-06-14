# Plugins Module

- Plugin identity (`plugin.id`, scoped by `scope` + `slug` + `ownerId`) and installation identity (`plugin_installation.id`) are separate.
- System installations are provisioned by exactly two paths: user bootstrap, and the boot-ingestion backfill for all existing users. Both run one idempotent `on conflict do nothing` statement, so a default row is `health = 'ready'`, `is_disabled = false`, `sort_order = 0`, `config = {}`, and backup account-cleanliness treats exactly that shape as clean. Admin-gated `testSupport.installSystemPlugin` does not provision, so a system plugin ingested that way has no installation rows until the next boot.
- Because every provisioned row shares `sort_order = 0`, system installations tie and resolve by slug. Do not reintroduce a snapshot-index default; ordering is Task 03's.
- Trust is decided by the internal shipped-source ingestion path plus persisted `plugin.scope = 'system'`, never by a slug allowlist. `bootConfiguredPluginSlugs` survives only as the shipped-package uninstall fence.
- The process-wide `PluginLoader` snapshot holds system plugins only. Private plugins are never loaded into it, so private ingestion must not publish registry invalidation and must not replace the snapshot.
- Private ingestion compiles outside the ingestion mutation semaphore; only its persistence transaction takes the ingestion advisory lock.
- `validatePrivateManifestSurfaces` rejects every surface this slice cannot run for a private plugin. Later tasks shorten that list as they land user-scoped registries; `boot` stays rejected permanently.
- Private script, operation and config lookups read `plugin`/`plugin_installation` directly because the snapshot cannot answer them; system lookups keep resolving through the snapshot.
- `resolvePluginConfigContext` is a security boundary: a private plugin's config resolves only for its owner's installation and must never fall back to `RYOT_PLUGIN_*` environment values.
