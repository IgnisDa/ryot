# Step 5 — media-monitoring + Remaining Media Logic + Phase Gate

**Parent Plan:** [Plugin System — Phase 3: Capability Migrations](./README.md)

**Type:** AFK

**Status:** complete

## Completed scope

The governing decisions and final verification are recorded in `docs/plans/plugin-system/00-overview.md`
and `docs/plans/plugin-system/03-phase-3-capability-migrations.md`.

The Step 5 migration, comprehensive purity triage, Task 10 imports e2e follow-up, and opt-in
operational gate are complete. The successful gate retained the original workload, assertions,
infrastructure path, and 15-minute budget.

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

The Phase gate is closed. The kernel media/fitness vocabulary grep and triage are complete, the
temporary step-2 `invokeOperation` scaffolding is gone, the standard e2e suite passes, and the
concurrent full-size media-import operational gate passes at its unchanged workload.

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
- [x] The branch stays shippable and the full e2e suite is green: backend `check` + unit tests,
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
- Initial operational gate: reproducible but timed out for two concurrent 1,001-item imports after
  901,013 ms.
  All eight packed workflows remained pending and zero reached terminal state. Recorded maxima and
  final deltas: database 5 active / 25 total connections, app-pool wait 0, lock wait 0, advisory
  locks sampled 0, advisory wait 0, deadlocks 0, Redis projections 8 / high-water 158 / errors 0,
  and sandbox executions 1,702 / max overlap 5.
- Task 10 imports e2e: the deferred failure was reproduced and repaired; the full standard suite is
  green.

## E2e gate repair record (2026-07-30, full gate complete)

The detailed causes, code changes, and justifications are owned by
[`docs/e2e-fixes-justifications.md`](../../e2e-fixes-justifications.md). This section records only
Task 11 gate progress.

The repair began from the documented Task 10/11 baseline and reproduced both failure classes in
isolation before changing code:

- Watcharr in `tests/src/tests/plugins/media/imports/imports.test.ts` stayed `running` until the 60-second poll expired.
- The Kodi episode-progress integration reached terminal `failed` with
  `Workflow activity reference could not be resolved`.
- The below-minimum progress case subsequently exposed
  `SandboxWorkflowNondeterminism: replay ended before recorded journal[3] activity:chunks-0`.

Current e2e verification after the fixes:

- Import coverage now owned by `tests/src/tests/kernel/imports/imports.test.ts`, `tests/src/tests/plugins/media/imports/imports.test.ts`, and `tests/src/tests/plugins/fitness/imports/imports.test.ts`: the original 10 tests passed.
- Integration coverage now owned by `tests/src/tests/kernel/integrations/integrations.test.ts` and `tests/src/tests/plugins/media/integrations/integrations.test.ts`: the original 21 tests passed.
- The formerly failing Watcharr, Kodi episode attachment, maximum-progress normalization, and
  minimum-progress filtering cases also pass independently.
- `bun turbo --filter=@ryot/tests check`: 12/12 tasks passed with zero warnings and errors.
- `bun turbo --filter=@ryot/tests test`: all 79 standard files and 501 standard tests passed.

The opt-in operational gate passed with its workload and 900-second budget unchanged. All eight
workflows completed in 361,548 ms, both imports returned 1,001 completed results, and the run observed
4,012 sandbox executions with overlap peaking at eight. It recorded no app-pool or advisory-lock
waits, deadlocks, or Redis projection errors. This closes Task 11 and the full Phase 3 gate.

## User stories addressed

- User story 33
- User story 34
- User story 35
- User story 36
- User story 38
- User story 39
- User story 40
- User story 41
