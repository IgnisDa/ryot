# Plugins Module

- Keep plugin identity (`plugin.id`) separate from installation identity (`plugin_installation.id`). User-owned catalog and configuration access must use the exact installation.
- Plugin reads use persisted plugin, revision, and installation state; nothing about the plugin catalog is held in process memory.
- User-scoped provider listings use `user_sandbox_provider`.
- Private uploads may not claim active system or bundled package IDs, regardless of installation visibility or local names.
- User manifests may not declare `httpRateLimits`. Validate all other declared surfaces and executable references like system packages.
- Private configuration resolves only through the owner's exact installation and never falls back to `RYOT_PLUGIN_*` environment values.
- Read system archives and private plugin uploads through the single reader from `@ryot-app/plugin-archive`; do not add a second archive reader in the kernel.
- Archive container limits apply equally to system and private packages.
- Resolve per-user catalogs from one `listPluginsAvailableToUser` snapshot and thread the resolved catalog through multi-row operations.
- Key automation hooks by stable plugin ID and authored hook slug. Resolve scripts by immutable revision ID, script slug, and content hash.
- Installation config pointer activation uses the ingestion transaction lock. Environment config is resolved at boot under the ingestion lock into `plugin.environment_config_revision_id`; nodes must share `RYOT_PLUGIN_*` values because the last booting node wins. Retained execution reads use exact revision/config pins and never resolve current environment values.
- The `plugin-config:<pluginId>` advisory key is shared for catalog readers and exclusive for configuration writers. One transaction must never take the shared form and later the exclusive form on the same key.
- `user_plugin.is_listed` includes hidden and installing installations but never incompatible installations.
- Initial private installation readiness belongs to `PluginInstallationWorkflow`. Identity-conflict quarantine never clears during reconciliation; explicit re-enable or package update must validate retained ownership, archive, config, declarations, and dependencies before recovery.
- Never infer `isInitialized` from ready health. Guarded bootstrap completion or an explicit no-entry system bootstrap proof owns that marker; compatible updates and quarantine preserve it.
