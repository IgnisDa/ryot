# Scoped Imports And Integrations

**Parent Plan:** [User-Owned Plugins](./README.md)

**Status:** done

## What to build

Deliver private plugin imports and integrations through the authenticated user's effective registry. Apply the parent plan's Persistence Model, User-Scoped Registries And Definitions, and Runtime Authority And Lifecycle decisions to import-source catalogs, integration-provider catalogs, import dispatch, integration workflows, and integration-authenticated operations.

Import creation must resolve an enabled source from the requesting user's exact installation, pin its workflow script and installation identity, and execute with that user's authority. Integration records must reference installation IDs and match the installation owner. An integration-authenticated operation must prove that the integration belongs to the same installation that declares the invoked operation, not merely that an enabled integration ID exists.

Build on the current server-driven import inputs and integration schemas, structured failure reasons, durable workflows, and exact script-ID execution. Change existing contracts and app-client consumers where required instead of introducing parallel catalog or form behavior.

## Acceptance criteria

- [x] Import-source and integration-provider catalogs are derived from the requesting user's ready, enabled effective registry.
- [x] Identical import-source or integration-provider slugs in unrelated user plugins do not collide or leak across users.
- [x] Import creation records plugin installation identity and pins the exact current workflow script before durable dispatch.
- [x] Import execution retains user authority and cannot resolve a source, workflow, config, or artifact grant from another installation.
- [x] Integration creation validates the provider and settings against the exact installation manifest and stores installation ownership.
- [x] Integration workflows resolve scripts and config from their stored installation and owner.
- [x] Integration-authenticated plugin operations reject an integration from another plugin installation, including another installation owned by the same user.
- [x] Disabled, incompatible, failed, or uninstalled installations cannot start new imports, integrations, or operations.
- [x] Existing uninstall fences use installation references and continue protecting integration and import workflow dependencies.
- [x] Catalog, import service, durable import, integration service, integration workflow, operation, repository, existing app-client consumers, and end-to-end tests cover isolation and exact ownership.

## User stories addressed

- User story 27
- User story 28
- User story 39

## Implementor Notes

Durable payloads must carry stable IDs and exact script pins. They must not re-resolve a mutable local slug when execution resumes.

## Implementation Notes

- `ImportSourceCatalog` and `IntegrationProviderCatalog` are now per-user and Effect-returning. Both read
  `PluginRuntimeResolver.listPluginsAvailableToUser` once per call, so a source or provider and its
  compiled script always resolve against one consistent view; the old "same snapshot" guarantee survives
  without a snapshot. Owned lookups key on `plugin_installation.id`, which makes the same-installation
  rule a literal identity comparison instead of an indirection through a slug.
- `validatePrivateManifestSurfaces` no longer rejects `importSources`, `integrationProviders`, `workflows`,
  `workflow`-kind scripts, or `auth: "integration"` operations. `boot`, `crons`, `userBootstrap`,
  `httpRateLimits` and every `bindings` collection stay rejected; Task 07 owns those.
  `validatePluginManifestReferences` now also checks that each import source's `workflowSlug` and each
  non-push integration provider's `scriptSlug` actually resolve, and the effective-registry collision check
  was widened from provider slugs to import-source and integration-provider slugs as well.
- `integration.plugin_installation_id` is authoritative, with a composite foreign key to
  `plugin_installation (id, user_id)` so "the integration's user equals the installation owner" is a
  database constraint rather than a route assumption. `integration.plugin_slug` survives as a display-only
  column because the RyotQL catalog, the recipes and the app client read it; Task 05 set the same precedent
  on `saved_view`. Nothing resolves, authorizes, or fences through it.
- `import_run.plugin_installation_id` records the resolving installation and is nullable with
  `on delete set null`, so historical runs survive an uninstall.
- Workflow pins moved from plugin slug to stable plugin id (`establishSandboxWorkflowPin`,
  `preRegisterPluginWorkflow`, `ImportWorkflowPinning.preRegister`). `ImportSourceState` now carries
  `pluginId` + `pluginInstallationId` instead of `pluginSlug`, so resuming durable import work never
  re-resolves a mutable local slug.
- `OperationsService.invoke` was restructured. It authenticates first, capturing `AuthUnauthorized` rather
  than swallowing it, then resolves the operation in the effective registry of whoever the caller turns out
  to be. An `auth: "integration"` operation additionally requires the integration's installation to equal
  the resolved operation's installation. Every authority failure returns the identical `operation-not-found`
  value so responses cannot distinguish a missing operation from a foreign one. An unauthenticated caller
  with no integration scope in the payload gets the original 401 back rather than a bad-request.
- `isPluginConfigKeyConfigured` now takes a `PluginConfigContext`, so a private import source reports its
  missing keys from installation config while shipped sources keep reporting `RYOT_PLUGIN_*` names.
- `hasIntegrationReferences` fences on identity: `{ pluginId, pluginInstallationId? }` joined through
  `plugin_installation`. Private uninstall narrows to the exact installation; shipped-plugin uninstall
  fences across all users.
- `OperationalGateService` gained a `PluginRuntimeResolver` dependency so its test-support import runs can
  supply an installation id; it now also honours per-user installation availability instead of trusting a
  bare slug.
- The Rust V1 integration migration resolves each owner's media system installation id and raises when any
  row is unresolvable, matching the module's fail-loud policy. Task 10 owns the full resolution-context
  rework.
- The Drizzle baseline migration was regenerated rather than extended, per the parent plan's allowance.

## Known Follow-Ups

- `findActiveOperation`, `isSystemPluginAvailableToUser` and `findUserOperation` on `PluginRuntimeResolver`
  lost their last callers. They are left in place with a `TODO(plugins)` for Task 11 rather than churning
  `runtime-resolver.test.ts` now. `findActiveOperation` is the one worth removing first: it resolves an
  operation by slug from the system snapshot with no user at all, which is the slug-only global lookup the
  parent plan forbids.
- `PluginInvocationError { code: "script-unavailable" }` is no longer emitted; a missing compiled script now
  folds into `operation-not-found`. Marked with a `TODO(plugins)` in the contract for Task 11 to keep or drop.
- Operation resolution stays system-first on a slug collision, so a user cannot shadow a system operation
  with a private one and also cannot reach their own private operation if a shipped plugin later claims that
  slug. Task 08 owns that conflict story.
- Private plugins still cannot declare `httpRateLimits`, so a private import or integration workflow's
  outbound calls are unthrottled for undeclared origins. Carried over from Task 01 and unchanged here.
- Private integration providers are limited to `lot: "push"`. A `yank`/`sink` provider must reference a
  `script`-kind script, and `validatePrivateManifestSurfaces` still rejects that kind, so the two
  validators are jointly unsatisfiable for those lots. This was left deliberately rather than widening the
  private script-kind allowlist: `script` is the kind `boot`, `crons` and `userBootstrap` consume, and
  those surfaces belong to Task 07. The integration-provider catalog already carries `pluginScope` and
  `installationId` for private entries, so the only change needed later is the allowlist. Until then the
  catalog's private branch is exercised only by `push` providers.
- The legacy integration SQL is validated by the dump-restore runbook rather than tests, per the
  legacy-bootstrap module's policy. It was not executed as part of this task.
- `IntegrationsService.listIntegrationProviders` calls `resolveOwnedForUser` per non-push provider, and
  each call re-reads the user's effective registry. `prepareYankRuns` has the same shape per due
  integration. Correct but N+1; the parent plan forbids per-user registry caching, so the fix is to thread
  one already-resolved registry through rather than re-resolving. Left for Task 11.
- `SandboxExecutionService.enqueuePluginWorkflow` still resolves a workflow by slug against the system
  snapshot. Its only caller is the admin-gated test-support operational gate, which now resolves an
  installation first and then hands the slug onward, so a private plugin passes the guard and then fails to
  resolve. Not reachable in production; Task 11 should reconcile the two.
- `saved_view` and `sandbox_workflow_reference` reference `plugin_installation` with `on delete restrict`
  while `user -> plugin_installation` cascades. Pre-existing from Tasks 04/05 and byte-identical at HEAD,
  but it is a latent undeletable-user hazard worth a Task 11 look.
- `IntegrationRecordSchema` in `integration-workflow-live.ts` gained a required `pluginInstallationId`, so
  a durable integration payload encoded before this change cannot be decoded on resume. Harmless on a
  greenfield deployment with no in-flight work, but worth knowing if one is ever replayed.
