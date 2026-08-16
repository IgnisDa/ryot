# Plugins Module

- Plugin identity (`plugin.id`, scoped by `scope` + `slug` + `ownerId`) and installation identity (`plugin_installation.id`) are separate. A system plugin has no installation row until a user overlays state on it.
- The process-wide `PluginLoader` snapshot holds system plugins only. Private plugins are never loaded into it, so private ingestion must not publish registry invalidation and must not replace the snapshot.
- Private ingestion compiles outside the ingestion mutation semaphore; only its persistence transaction takes the ingestion advisory lock.
- `validatePrivateManifestSurfaces` rejects every surface this slice cannot run for a private plugin. Later tasks shorten that list as they land user-scoped registries; `boot` stays rejected permanently.
- Private script, operation and config lookups read `plugin`/`plugin_installation` directly because the snapshot cannot answer them; system lookups keep resolving through the snapshot.
- `resolvePluginConfigContext` is a security boundary: a private plugin's config resolves only for its owner's installation and must never fall back to `RYOT_PLUGIN_*` environment values.
