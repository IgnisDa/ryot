# Step 4 — Integration + Import-Source Adapters + FS Grants

**Parent Plan:** [Plugin System — Phase 3: Capability Migrations](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Before starting, read `docs/plans/plugin-system/00-overview.md` in full and then
`docs/plans/plugin-system/03-phase-3-capability-migrations.md` in full. Do not begin until Step
3b (task 06) is done. This slice implements plan §4 end-to-end: kernel capability first, then the
adapter scripts that consume it, then delete the native provider-specific code and re-point the
suites.

Kernel capability (lands before consumers):

- Extend integration registration so a plugin declares integration _providers_
  `{ slug, lot (yank|sink|push), driverRef, settingsSchema }`; the kernel integrations framework
  (credential storage, enable/disable, auto-disable, run bookkeeping) serves them generically and
  lists available providers from the registry.
- Filesystem grants (Decision 10, deny-by-default): the kernel materializes an uploaded/fetched
  artifact to a path and spawns the execution with `--allow-read` on it plus a quota'd,
  kernel-cleaned per-execution scratch dir with `--allow-write`; grants are declared per driver
  kind in the manifest (`capabilities: ["artifact-read", "scratch"]`). Implement this next to the
  existing flag assembly in `runtime.ts` (`makeSpawnDenoProcess`). Since pooled processes are
  pre-warmed before the execution is known, grant-carrying executions run on a dedicated
  (non-pooled) process (`[RECOMMENDED]` — measure before optimizing).
- Add `fflate` as an approved sandbox dependency (via the Step 0a vendoring mechanism) so zip
  parsing happens inside the sandbox, not as a host function.

Migration: move `integrations/sinks/*` normalization + yank connectors + import-source adapters
into media-plugin scripts (bounded network via `httpCall` with integration credentials through
the existing `getIntegration`; audit that credential exposure to scripts stays scoped to the
integration being executed). Preserve `createProgressResult` semantics (`sinks/shared.ts` —
`occurredAt` always set, which the progress-policy automation depends on). Push targets
(radarr/sonarr/jellyfin) are already sandbox trigger scripts whose bindings moved in Phase 2 —
no further migration. Delete the native sink/yank adapter code from `modules/integrations` and
the media import-source adapters from `modules/imports`, leaving the frameworks.

See the parent PRD "Step 4 — integration + import-source adapters" user stories and the
Implementation Decisions "Step 4" pointer for the full spec.

## Acceptance criteria

Derived from the plan §4 done criteria and cross-phase invariants:

- [ ] Integration-provider manifest registration works; the kernel framework serves and lists
      registry-declared providers generically
- [ ] Deny-by-default filesystem grants work: artifact `--allow-read` + quota'd,
      kernel-cleaned scratch `--allow-write`, declared per driver kind
      (`capabilities: ["artifact-read", "scratch"]`); grant-carrying executions run on a
      dedicated process
- [ ] `fflate` is an approved sandbox dependency; zip parsing happens inside the sandbox
- [ ] Native sink/yank adapters and media import-source adapters are moved into the plugin;
      the kernel `integrations`/`imports` modules contain **zero provider-specific code**;
      credential exposure is scoped to the executing integration; `createProgressResult`
      semantics preserved
- [ ] `integrations/` + `imports/` e2e suites re-pointed with assertions preserved
- [ ] The branch stays shippable: backend `check` + unit tests, the full e2e suite, and the
      `app-client` check all pass (cross-phase invariant 1)

## User stories addressed

- User story 26
- User story 27
- User story 28
- User story 29
- User story 30
- User story 31
- User story 32
- User story 37
- User story 38
- User story 39
