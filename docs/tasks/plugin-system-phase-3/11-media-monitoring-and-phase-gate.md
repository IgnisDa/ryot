# Step 5 — media-monitoring + Remaining Media Logic + Phase Gate

**Parent Plan:** [Plugin System — Phase 3: Capability Migrations](./README.md)

**Type:** AFK

**Status:** in progress

## Current scope

Read `docs/plans/plugin-system/00-overview.md` in full and then
`docs/plans/plugin-system/03-phase-3-capability-migrations.md` in full before resuming gate work.

The Step 5 migration and comprehensive purity triage are complete. Remaining work is Phase 3 gate
closure: the timed-out opt-in operational gate and the owner-skipped Task 10 imports e2e
follow-up. Do not repeat the migration or treat the deferred failure as green.

Completed migration:

- `modules/media-monitoring` was rewritten as composition: monitoring sweeps = cron +
  `executeQueryEngine` pushdown + signals; refresh flows compose the step-3 workflows;
  notification fan-out uses the existing signal/subscription machinery.
- The `media-monitoring` contract group's user-facing status/enable/disable surface moved to direct
  plugin operations using `user` auth; no admin operation mode was added.
- Leftover media behavior in `signals`, `events`, and `entity-interest` moved into plugin-owned
  composition while the generic interest/translation machinery stayed in the kernel.
- The media resolution provider-to-activity-script map remains private media-plugin implementation
  data, and no kernel import of `@ryot/plugin-media/workflows/schemas` remains.

Remaining Phase gate work: close the timed-out concurrent full-size media-import operational gate
and the owner-skipped Task 10 imports e2e follow-up. The kernel media/fitness vocabulary grep and triage
are complete, and the temporary step-2 `invokeOperation` scaffolding is gone.

See the parent PRD "Step 5 — media-monitoring + remaining media logic" and "Cross-cutting" user
stories and the Implementation Decisions "Step 5" / "Phase gate" pointers for the full spec.

## Acceptance criteria

Derived from the plan §5 done criteria, the phase gate, and cross-phase invariants:

- [x] `modules/media-monitoring` is migrated (sweeps = cron + query-engine pushdown + signals;
      refresh = step-3 workflows; user-facing surface = direct step-2 operations) and deleted;
      scheduler execution uses trusted system authority rather than an executable name
- [x] Leftover media references in `signals`, `events`, and `entity-interest` are migrated or
      removed; the generic interest/translation machinery stays in the kernel
- [x] **No module under `apps/app-backend/src/modules/` is media- or fitness-specific**
- [x] The `media-monitoring/` e2e suites (association detectors + cron-refresh coverage) pass
      with assertions unchanged — the acceptance test that the syscall surface is sufficient
- [x] The phase-gate grep for media/fitness vocabulary is run and every hit is triaged (deleted,
      generalized, or justified in the plan file); each touched `AGENTS.md`/`README.md` is
      updated where conventions changed (cross-phase invariant 7)
- [ ] The branch stays shippable and the full e2e suite is green: backend `check` + unit tests,
      `cd tests && bun run test`, and the `app-client` check all pass (cross-phase invariant 1)

## Blockers and verification

- Step 5 migration: complete. Native `media-monitoring` and contract code are deleted; operations,
  workflow crons, and plugin ownership are in place. No media- or fitness-specific module remains
  outside the documented `legacy-bootstrap` V1-adoption quarantine.
- Purity gate evidence: the comprehensive kernel vocabulary grep and triage are complete and
  recorded in the Phase 3 plan. Recursive children are generalized through
  `expectedChildEntitySchemaSlug`, automation context uses `parentEntity`, and the media plugin owns
  interpretation of season properties and other media-specific rules.
- Media-monitoring e2e: 4 files, 13 tests passed with assertions unchanged.
- System-query e2e: 1 file, 9 tests covering 11 cases passed.
- Combined system-query and media-monitoring e2e: 5 files, 22 tests passed.
- Backend unit tests: 131 files, 931 tests passed.
- Media-plugin tests: 92 files, 351 tests passed.
- Backend, app-client, and media-plugin checks: passed with zero warnings.
- Monitoring not-found behavior: the owner-approved change remains an aligned per-item
  `{ status: "notFound" }` result, preserving successful siblings in mixed batches.
- Operational gate: reproducible but timed out for two concurrent 1,001-item imports after 901,013 ms.
  All eight packed workflows remained pending and zero reached terminal state. Recorded maxima and
  final deltas: database 5 active / 25 total connections, app-pool wait 0, lock wait 0, advisory
  locks sampled 0, advisory wait 0, deadlocks 0, Redis projections 8 / high-water 158 / errors 0,
  and sandbox executions 1,702 / max overlap 5. The opt-in test remains a blocker and runs only with
  `RUN_OPERATIONAL_GATES=1` (or `true`).
- Task 10 imports e2e: owner-skipped. Its deferred failure remains
  open; no branch-wide or full e2e run is claimed green.

## User stories addressed

- User story 33
- User story 34
- User story 35
- User story 36
- User story 38
- User story 39
- User story 40
- User story 41
