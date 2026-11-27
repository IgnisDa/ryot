# Plugins

- User-owned access uses the exact installation ID, not the stable plugin ID. Resolve each multi-row operation from one persisted catalog snapshot.
- Private packages cannot claim active system or bundled package IDs or declare `httpRateLimits`. Private configuration never falls back to environment values.
- Use `@ryot-app/plugin-archive` for every archive, with identical system/private container limits.
- Configuration activation takes the ingestion lock. Retained execution uses exact revision/config pins, never current environment values.
- Never upgrade `plugin-config:<pluginId>` from a shared to an exclusive advisory lock within one transaction.
- Readiness, initialization, and quarantine are distinct. Initialization requires guarded bootstrap completion or explicit no-entry system proof; updates and quarantine preserve it. Reconciliation never clears identity-conflict quarantine. Recovery validates retained ownership, archive, configuration, declarations, and dependencies.
- Read `README.md` before changing ingestion, installation lifecycle, or configuration resolution.
