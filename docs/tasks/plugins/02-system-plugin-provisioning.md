# System Plugin Provisioning

**Parent Plan:** [User-Owned Plugins](./README.md)

**Status:** done

## What to build

Deliver the trusted shipped-plugin path on top of explicit installations. Apply the parent plan's Plugin Ingestion And Installation, Configuration, Runtime Authority And Lifecycle, and HTTP Contract decisions to the media and fitness packages. New users must receive system installations automatically, shipped packages must continue to use environment config, and trusted boot, system cron, and first-install user-bootstrap behavior must preserve their intended authority.

Trusted status must come from the internal shipped-source ingestion path and persisted system scope, not from a user-supplied slug. System plugin slugs are reserved against private installation. System installations are visible in the authenticated installation list, may be user-disabled for user-scoped surfaces, and cannot be updated or uninstalled through private-plugin endpoints.

Use the same installation provisioning behavior for ordinary new-user bootstrap and newly introduced system packages. Lifecycle execution must remain outside database transactions and use deterministic durable identities where dispatch can outlive a request.

## Acceptance criteria

- [x] Media and fitness ingest as system-scoped plugins through the trusted startup path and cannot be impersonated by private uploads.
- [x] Every newly created user receives one installation for every current system plugin before plugin-defined user initialization needs the registry.
- [x] System scripts continue to resolve plugin config from normalized server environment variables and never from installation config.
- [x] Existing trusted instance boot and system cron entries execute once per instance with system authority.
- [x] System user-bootstrap entries execute once for a newly provisioned user installation with that user's authority.
- [x] User-facing list output distinguishes system installations from private installations without exposing environment config.
- [x] Users may disable system installations for user-scoped runtime surfaces but cannot update their source, configure environment values, or uninstall them.
- [x] Private install rejects current system plugin slugs before compilation or persistence.
- [x] Provisioning and lifecycle operations are restart-safe and do not duplicate installation rows or bootstrap effects.
- [x] Focused startup, user-bootstrap, scheduler, configuration, service, and endpoint tests preserve system behavior under the new model.

## User stories addressed

- User story 23
- User story 24
- User story 25
- User story 34
- User story 35
- User story 36

## Implementor Notes

System package ingestion remains an internal startup concern. Do not retain the administrator upload endpoint as an alternate way to create system plugins.

## Implementation Notes

- Trust now derives from the persisted `plugin.scope = 'system'` column plus the internal shipped-source
  ingestion path. `bootConfiguredPluginSlugs` survives only as the shipped-package uninstall fence, which
  is genuinely about the shipped set rather than about authority.
- System installations are provisioned by exactly two paths, both running one idempotent
  `on conflict (user_id, plugin_id) do nothing` statement: user bootstrap, and a boot-ingestion backfill
  over all existing users. Admin-gated `testSupport.installSystemPlugin` deliberately does not provision,
  so a system plugin ingested that way has no installation rows until the next boot.
- `PluginUserBootstrapDispatcher` now derives its entries from the user's provisioned system
  installations rather than a slug allowlist, keeping the previous ordering and the deterministic
  `userBootstrapExecutionId` identity that makes reruns safe.
- Drizzle `1.0.0-rc.5-169397b` insert-select was unusable because `plugin_installation.id` has no
  database default, so provisioning is a shared `sql` template executed via `db.execute`, using
  `gen_random_uuid()::text` as the legacy-bootstrap modules already do.
- `config` was removed from `UpdatePluginStateBody` and `ListedPlugin` entirely. A user could previously
  write arbitrary config onto a system installation, which contradicts the parent plan's rule that system
  installation config stays empty and environment-backed.
- Backup account-cleanliness had to learn about default system installations. It previously rejected any
  installation row at all, which would have made every account permanently unrestorable once provisioning
  landed. A default row (`system` scope, ready, enabled, `sort_order = 0`, empty config) is now clean.
- `PluginInstallationRepository.restore` became an upsert. With default system installations present,
  restore's plain insert hit `plugin_installation_user_plugin_unique` and every restore failed.
- Two paths beyond the original plan needed the installation service because both reach
  `performBootstrap`: `user-lifecycle/workflow.ts` (god-mode reset) and `MigrationInfrastructureLive`
  (legacy migration, whose users therefore get system installation rows while their bootstrap scripts stay
  no-op'd as before).
- All system installations persist `sort_order = 0`, so they tie and resolve by slug instead of by the old
  snapshot index. The `defaultSortOrder` index fallbacks are now dead for system plugins. A test locks the
  tie-break; reordering itself is Task 03's.

## Known Follow-Ups

- Task 08 owns the durable fan-out of system user-bootstrap entries to users backfilled by a newly
  shipped system plugin, and marking same-slug private installations `incompatible`. Marker left in
  `plugins/boot.ts`.
- Task 01's reverse slug-shadowing follow-up was reassigned from this task to Task 08 rather than closed.
  System ingestion still does not reject a slug already held by a private plugin, and it should not:
  rejecting would let user code block a shipped upgrade, contradicting user story 37. Task 08's
  `incompatible` health transition is the correct resolution, so operation resolution stays system-first
  and can still shadow a private operation of the same slug until then.
- Task 09 should revisit `PluginInstallationRepository.restore`: the upsert never applies the archived
  row id, and an archive carrying two `pluginState` entries for one plugin now last-wins silently instead
  of being rejected. Benign today because nothing references `plugin_installation.id`.
- Every archive now records media and fitness as exact version requirements, because export feeds all
  `pluginState` into `requiredPlugins` and restore demands an exact match. This is the parent plan's
  intent (user story 44) but universal provisioning makes it apply to every user, so a backup taken
  before a shipped-plugin version bump is unrestorable after the upgrade. Task 09 should decide whether
  that is the desired restore ergonomics.
- `provisionSystemInstallationsForAllUsers` runs a full users x system-plugins insert on every restart.
  Cheap at current scale and idempotent, but it is unconditional work.
- The `scope = 'system'` and `status = 'active'` provisioning predicates have no automated test. Backend
  unit tests have no real database (`databaseLayer` is a stub), and covering them in e2e would require
  mutating shared-backend plugin registry state. They were verified manually against a real Postgres
  container during review.
