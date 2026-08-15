# Private Automations And Lifecycle

**Parent Plan:** [User-Owned Plugins](./README.md)

**Status:** done

## What to build

Complete private plugin lifecycle and remaining runtime surfaces. Follow the parent plan's Plugin Ingestion And Installation and Runtime Authority And Lifecycle decisions for event, entity, relationship, signal, and provider-import automations; installation user bootstrap; private cron; and capability enforcement.

Private instance boot declarations are rejected. User-bootstrap entries run once through the installation lifecycle owner with deterministic IDs and user authority. Private cron entries are discovered per ready, enabled installation and execute with owner authority. Automation bindings are evaluated only from the affected data owner's effective registry.

## Acceptance criteria

- [x] Private plugin ingestion rejects every instance boot declaration with a clear validation error.
- [x] A private installation enters installing health, runs declared user-bootstrap entries once in deterministic order with owner authority, and becomes ready only after success.
- [x] Terminal bootstrap failure produces failed health and a safe diagnostic without exposing sandbox internals or activating runtime surfaces.
- [x] Retried installation workflows do not duplicate bootstrap effects, and package updates do not dispatch installation bootstrap.
- [x] Private cron discovery creates one schedule per ready, enabled installation and uses deterministic execution IDs containing installation identity and occurrence.
- [x] Private cron execution always uses installation-owner authority; system cron and boot behavior remains system-authority and once per instance.
- [x] Event, entity, relationship, signal, and provider-import automations resolve only from the data owner's ready, enabled effective registry.
- [x] Capability declarations cannot bypass host-function authority checks or grant a private plugin system-only behavior.
- [x] Disablement prevents new bootstrap-independent automation and cron dispatch while preserving already pinned workflow semantics.
- [x] Validation, installation workflow, scheduler, automation policy, durable dispatch, and host capability tests cover authority and idempotency.

## User stories addressed

- User story 29
- User story 31
- User story 32
- User story 33
- User story 40

## Implementor Notes

Use one durable owner for installation bootstrap. Parent workflows may orchestrate entries, but activities must not start workflows or durable queues.


## Implementation Notes

- `validatePrivateManifestSurfaces` now rejects only `boot` (permanently), `httpRateLimits`, and
  operations whose `auth` is neither `user` nor `integration`. `crons`, `userBootstrap`, every
  `bindings.*` collection and every script `kind` are validated exactly like a system package by
  `validatePluginManifestReferences` and `validatePluginExecutableScripts`. This incidentally lifts
  Task 06's follow-up that made non-`push` private integration providers unsatisfiable: they require a
  `script`-kind script, which private packages may now declare.
- The four remaining automation binding collections gained the `kind === "automation"` assertion that
  `providerEntityImportAutomations` already had. Those surfaces were previously system-only, so the
  missing check was unreachable; opening them to private packages made it reachable. Crons deliberately
  did **not** get a kind assertion: the shipped media plugin's `media-monitoring` cron references
  `workflow.media-monitoring-sweep`, a `workflow`-kind script, so `script`-only would break boot.
- A private installation is persisted `installing` and reaches `ready` only through
  `PluginInstallationWorkflow`, dispatched after the persistence transaction commits. The install
  response therefore reports `installing`; e2e fixtures poll to a settled installation.
- Bootstrap entries execute from the workflow body, never inside an Activity, because
  `SandboxExecutionService.executeScript` starts `SandboxScriptWorkflow` and activities may not start
  workflows. Per-entry execution ids derive from installation id plus entry slug, so replay reuses the
  same durable execution instead of repeating the effect.
- `begin-plugin-installation` returns null unless the installation still exists, is user-scoped, and is
  `installing`. That single guard is what makes duplicate dispatch a no-op and what guarantees a package
  update can never re-run bootstrap.
- Persisted failure reasons are built from the bootstrap entry slug alone; sandbox messages are logged
  and never stored on the installation.
- `PluginInstallationService` must not require `WorkflowEngine` because it is also built into
  `MigrationInfrastructureLive`. `PluginInstallationLifecycleDispatcher` defaults to a no-op and
  `layers.ts` provides the live dispatcher only on the runtime path. That runtime variant wraps
  `Layer.fresh(PluginInstallationService.layer)`: both variants share one layer object, layers memoize
  by object identity, and the migration graph builds first, so without `Layer.fresh` the runtime
  silently inherits the no-op dispatcher and every private installation stays `installing` forever.
  Unit tests mock the dispatcher and so cannot observe it; `scripts/layer-wiring.ts`, run from the
  kernel purity check, guards it structurally by rejecting any `Service.layer` built more than once
  without `Layer.fresh`.
- `getEffectiveDefinitions` treats `installing` installations as definition-visible so a bootstrap
  script can read its own plugin's schemas. Runtime availability (`availablePluginIdsForUser`,
  `listPluginsAvailableToUser`) stays strictly `ready` and not disabled, so an `installing` installation
  reaches no dispatch surface.
- Automation bindings are keyed on stable `plugin.id` rather than plugin slug, and each binding carries
  the content hash it was built from, so a binding's script resolves as
  `(pluginId, scriptSlug, contentHash)` instead of the previous global slug scan. `listAutomations`,
  `findAutomation` and `listProviderEntityImportAutomations` all take the data owner and enumerate that
  owner's effective registry. Persisted `automation_run.rule_id` values change shape as a result, which
  is acceptable on a greenfield deployment.
- Private crons are discovered per ready, enabled installation and dispatched with owner authority under
  a separate `private-plugin-cron-` id space. `resolvePrivatePluginCron` re-checks availability and the
  current content hash at dispatch time because discovery and dispatch are separate ticks.
- `dispatchAll` gained bounded concurrency. `dispatch` awaits its script and the scheduler ticks with
  `Effect.forever`, so once every user's private crons joined the tick a single slow user script would
  otherwise have delayed or skipped cron minutes for every other user and for the system crons.
- `ensureUserEntities` was deliberately not widened. It remains gated to trusted system user-bootstrap
  callers, so a private bootstrap script that declares the capability is still refused at the host
  function. That is the capability-cannot-elevate criterion, and it is tested.

## Known Follow-Ups

- A private installation can be stranded in `installing` if the process dies between the install
  transaction committing and the lifecycle workflow being enqueued. Recovery today is uninstall plus
  reinstall. The fix is a boot-time sweep re-dispatching `installing` user-scoped installations, which is
  idempotent by construction because the execution id is deterministic and `begin` no-ops on settled
  rows. Assigned to Task 08, which already owns boot-time installation reconciliation.
- `failed` health is terminal. A package update calls `updateState`, which never touches `health`, so a
  failed installation cannot be repaired by pushing a fixed package -- only by uninstalling and
  reinstalling. Task 08 should decide whether an update should reset health and re-run lifecycle.
- Private plugins still cannot declare `httpRateLimits`, so a private plugin's outbound calls to an
  undeclared origin remain unthrottled. `PluginHttpRateLimitAuthority` builds instance-global policy from
  `listActiveManifests()`, which is system-scoped. Carried from Tasks 01 and 06; marked `TODO(plugins)`
  for Task 11.
- A private bootstrap script has a thin useful capability set, because the one capability built for
  seeding owner data, `ensureUserEntities`, is restricted to trusted system callers. If user story 31
  needs private plugins to seed their own entities, a later task must make
  `resolveTrustedUserBootstrapCaller` owner-aware and resolve the schema-ownership check through the
  owner's effective registry rather than the process-wide `DefinitionRegistry`.
- `findProviderAvailableToUserWhere` gates the provider on `ready` in SQL but checks its
  `rootEntitySchemaSlug` against the now-widened effective definitions, so a ready provider whose root
  schema comes from a still-`installing` plugin resolves where it previously did not. Harmless given
  install-time reference validation, but it falls out of the widening rather than being intended by it.
- The private cron unit tests use a fake executor that cannot evaluate SQL. They now assert the gate
  literals appear in the emitted query, but the real `scope`/`status`/`health`/`is_disabled` predicates
  remain covered only by that indirect assertion. Same limitation Task 02 recorded for provisioning.
- `validatePrivateManifestSurfaces` still carries an operation-auth branch that cannot fire, because
  `PluginOperationAuth` is exactly `"user" | "integration"`. It is kept as a guard in case a third auth
  kind is ever added, and is the source of the one pre-existing lint warning in the module. Task 11
  should decide whether to keep it.
