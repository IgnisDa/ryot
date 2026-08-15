# System Plugin Reconciliation And Conflicts

**Parent Plan:** [User-Owned Plugins](./README.md)

**Status:** done

## What to build

Reconcile shipped system plugins and private conflicts across backend processes and server upgrades. Keep the existing process-wide package-catalog invalidation and reconciliation behavior for package ingestion and updates. Resolve user-effective registries from current installation state on demand; do not add per-user registry caches, generations, or invalidation infrastructure.

Startup reconciliation must ingest current shipped packages, update existing system plugin records and installations, provision newly shipped plugins for existing users through durable fan-out, and keep system functionality available when a private installation conflicts with a new system slug or definition. Conflicting private installations become incompatible with a safe reason; their qualified historical definitions remain attributable but their runtime surfaces are inactive.

## Acceptance criteria

- [x] Existing process-wide package-catalog invalidation and reconciliation continue making package ingestion and updates visible across backend processes.
- [x] User-effective registry resolution reads current installation state without per-user snapshots, generations, or invalidation messages.
- [x] Startup updates current system packages and all applicable installation references without allowing private code to block system ingestion.
- [x] A new system plugin is installed for existing users with restart-safe durable fan-out and deterministic installation identities.
- [x] Conflicting private installations enter incompatible health with a safe diagnostic and disappear from active runtime resolution.
- [x] Historical records owned by an incompatible private plugin still resolve through qualified plugin identity.
- [x] Resolving or removing a conflict permits health reconciliation without recreating plugin or installation identity.
- [x] Tests cover process-wide package update visibility, system release changes, new-system provisioning, private conflict handling, and current installation-state resolution.

## User stories addressed

- User story 36
- User story 37
- User story 38

## Implementor Notes

Reuse existing process-wide package-catalog coordination.

## Implementation Notes

- Startup now calls `PluginInstallationService.reconcileSystemInstallations()`: the all-users backfill
  followed by private-conflict reconciliation. The backfill inserts `installing` rows and targets only
  users whose `bootstrap_completed_at` is set, so `performBootstrap`'s inline
  `PluginUserBootstrapDispatcher` and the durable fan-out can never both own one `(user, plugin)` pair.
- The `installing` row is the durable work record. `PluginInstallationSweepDispatcherLive` runs on the
  runtime path only and dispatches `PluginInstallationWorkflow` for every pending installation. That is
  what makes the fan-out restart-safe: the insert is `on conflict do nothing`, the execution id derives
  from the installation id, and `begin` no-ops unless health is still `installing`. It also closes Task
  07's stranded-`installing` follow-up, because a private installation orphaned by a dying process is
  swept by the same query.
- `PluginInstallationWorkflow` now serves both scopes. `begin` gates on `health === 'installing'` alone,
  and `complete` materializes the owner's saved views before flipping to `ready`, so a newly shipped
  plugin's declared views actually reach existing users.
- Conflict detection evaluates each private plugin against the shipped set alone -- slug reservation,
  provider/import-source/integration-provider slug collisions, and direct definition-slug claims -- then
  validates references once per owner across the survivors. Pass one deliberately avoids
  `buildEffectiveDefinitions`: a private plugin may legitimately reference a sibling private plugin's
  definitions, and a whole-set compose would misattribute blame.
- Health transitions are narrow. Only `ready` and `incompatible` become `incompatible`; only
  `incompatible` returns to `ready`; `installing`, `failed` and `needs-configuration` are left alone. An
  `installing` row belongs to its in-flight lifecycle workflow: flipping it out of `installing` would make
  that workflow's `begin` a permanent no-op and strand the installation without its `userBootstrap`
  entries. A conflicted
  row's generated saved views are removed regardless of health, because a stale builtin row makes the
  shipped plugin's `ensureBuiltinViews` fail and would end the shipped installation `failed`. Owners
  whose health changed in either direction are re-materialized exactly once.
- `getEffectiveDefinitions` composes defensively in one ordered pass: drop private definitions whose slug
  the shipped or kernel base claims, then relationship schemas whose entity schema did not survive, then
  `related_users` signal schemas whose relationship schema did not survive, then saved views whose entity
  schema did not survive. Without it, excluding one installation could make `buildDefinitionSnapshot`
  throw a defect out of a `DbError`-typed effect. `includeUnavailable` now means disabled or still
  installing, never `incompatible`.
- `failed` stays terminal for a private installation. A package update deliberately does not reset health
  or re-run bootstrap, because the parent plan makes user bootstrap installation lifecycle rather than
  release migration behavior; recovery is uninstall plus reinstall. `incompatible` is different and is
  reconciled in place, either at the next boot or by a successful package update.
- Uninstall resolves private-first so a private installation shadowed by a newly shipped slug stays
  removable. Update and installation patch still resolve system-first.
- Backup account cleanliness accepts an `installing` system installation. Without that, every account
  would be unrestorable between a shipped-plugin upgrade and the sweep.
- `testSupport.reconcilePluginInstallations` is the admin-gated hook that re-runs boot reconciliation plus
  the sweep, because the e2e harness cannot restart the backend with a new shipped package. The suite
  using it owns its own backend and infrastructure, since the reconcile is instance-global and would
  otherwise provision rows for every other suite's users.

## Known Follow-Ups

- `dispatchPendingInstallationLifecycle` logs and continues when a dispatch fails, and the sweep runs only
  at layer build, so with `SCHEDULER_DISABLE_DISPATCHERS` set on the only process a backfilled
  installation stays `installing` until the next start.
- A shadowed private installation reports the same local slug as the shipped plugin in listings, and patch
  and update resolve system-first, so it can be uninstalled but not disabled or reordered. Disambiguating
  needs an installation id at the API boundary, which is a contract change outside this task.
- A colliding definition slug resolves to the shipped definition even in the historical view, so slug-keyed
  lookup attributes persisted rows on that slug to the shipped plugin rather than the owner's incompatible
  one. Row-level plugin provenance is unaffected.
- A private installation that is still `installing` when it starts conflicting keeps that health, so its
  lifecycle workflow finishes and turns it `ready` while still conflicted; its generated views are removed
  now, but the conflict itself is only re-detected at the next boot reconciliation. That is deliberate: the
  workflow owns the row, and the ordered definition filter keeps composition sound and lets the shipped
  definition win in the meantime.
- New definitions of an already-installed shipped plugin still never reach existing users. Only a newly
  provisioned installation runs `complete`, and reconciliation re-materializes an owner only when one of
  their private installations changed health.
- Shipped-plugin uninstall leaves its generated saved views behind, so a later private installation cannot
  materialize a view under that slug. The new e2e suite uninstalls its private plugin at the end of the
  body to stay hermetic.
- `listPrivateInstallations` loads every private installation with its full manifest at boot, with no
  paging.
- Task 09 inherits Task 02's note that a backup taken before a shipped-plugin release is unrestorable
  after it, and now also that cleanliness accepts an `installing` system installation.
