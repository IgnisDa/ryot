# Plugins Module

- Keep plugin identity (`plugin.id`) separate from installation identity (`plugin_installation.id`). User-owned catalog and configuration access must use the exact installation.
- The process-wide `PluginLoader` snapshot contains system plugins only. Private-plugin reads use persisted plugin and installation state and must not publish loader invalidations.
- User-scoped provider listings use the persisted ready, enabled plugin catalog and effective definitions, never the process-wide loader snapshot.
- A plugin slug is the client's first URL segment, so `validatePluginManifestPolicy` rejects `reservedPluginSlugs` for system and user scope alike. Reserving a new name means adding it in `@ryot-app/contract`, not in the kernel.
- User manifests may not declare `boot`, `userBootstrap`, or `httpRateLimits`. Validate all other declared surfaces and executable references like system packages.
- Private configuration resolves only through the owner's exact installation and never falls back to `RYOT_PLUGIN_*` environment values.
- Read system archives and private plugin uploads through the single reader from `@ryot-app/plugin-archive`; do not add a second archive reader in the kernel.
- Archive container limits apply to both system and private packages. Keep `PLUGIN_PACKAGE_LIMITS` private-only; system plugins may exceed those package limits.
- Resolve per-user catalogs from one `listPluginsAvailableToUser` snapshot and thread the resolved catalog through multi-row operations.
- Key automation hooks by stable plugin ID and authored hook slug. Resolve scripts by immutable revision ID, script slug, and content hash.
- Installation config pointer activation uses the ingestion transaction lock. Environment config is resolved per node at boot into the process-local `PluginEnvironmentConfig` map and has no pointer row. Retained execution reads use exact revision/config pins and never resolve current environment values.
- The `plugin-config:<pluginId>` advisory key is shared for catalog readers and exclusive for configuration writers. One transaction must never take the shared form and later the exclusive form on the same key.
- `getEffectiveDefinitions(userId, true)` includes disabled and installing installations but never incompatible installations.
- A private installation becomes ready only through `PluginInstallationWorkflow`; uninstall must still resolve a private plugin shadowed by a system slug.
