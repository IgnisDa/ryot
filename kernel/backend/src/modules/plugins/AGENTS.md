# Plugins Module

- Keep plugin identity (`plugin.id`) separate from installation identity (`plugin_installation.id`). User-owned catalog and configuration access must use the exact installation.
- The process-wide `PluginLoader` snapshot contains system plugins only. Private-plugin reads use persisted plugin and installation state and must not publish loader invalidations.
- Private manifests may not declare `boot` or `httpRateLimits`. Validate all other declared surfaces and executable references like system packages.
- Private configuration resolves only through the owner's exact installation and never falls back to `RYOT_PLUGIN_*` environment values.
- Read system archives and private plugin uploads through the single reader from `@ryot/plugin-archive`; do not add a second archive reader in the kernel.
- Archive container limits apply to both system and private packages. Keep `PLUGIN_PACKAGE_LIMITS` private-only; system plugins may exceed those package limits.
- Resolve per-user catalogs from one `listPluginsAvailableToUser` snapshot and thread the resolved catalog through multi-row operations.
- Key automation bindings by stable plugin ID and resolve scripts by plugin ID, script slug, and content hash.
- `getEffectiveDefinitions(userId, true)` includes disabled and installing installations but never incompatible installations.
- A private installation becomes ready only through `PluginInstallationWorkflow`; uninstall must still resolve a private plugin shadowed by a system slug.
