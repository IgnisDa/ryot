# Final Architecture Documentation and Phase Gate

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** todo

## What to build

Bring all owning documentation and the Phase 4 acceptance record in line with the implemented final
architecture. Read the overview, Phase 4 plan, parent PRD, and this task first.

Complete the plugin authoring reference, sandbox runtime reference, test ownership/fixture/budget
conventions, module ownership notes, plan decision records, performance measurements, and known
exceptions under the single-owner rule. Retain the backup client and add the owner-requested deletion
TODO to every affected backup/dependent file; document its narrow purity exception. Then run and
record the full Phase 4 acceptance matrix before cleanup. Refactor the analysis currently embedded in
`scripts/module-dag.ts` so both an optional HTML renderer and a non-rendering purity check consume it;
resolve the existing runtime cycles and wire zero-cycle enforcement into `purity:check` without a
baseline allowlist.

## Acceptance criteria

- [ ] Plugin authoring docs cover manifest sections, script kinds, providers, entrypoints, authority, capabilities, caches, determinism, and batch-first guidance
- [ ] Sandbox docs cover file modules, host functions, grants, bridge concurrency, workflows, limits, liveness, and private Promise interop
- [ ] Test docs describe the kernel/media/fitness tree, fixture lifecycle, standalone operational gate, and final pool arithmetic
- [ ] Added/deleted/changed modules have one authoritative ownership document with no stale duplicate facts
- [ ] Phase plans record implementation decisions, deviations, measurements, and Phase 5 deferrals accurately
- [ ] Every affected backup/dependent file contains the requested future-deletion TODO and the backup remains present
- [ ] Purity allowlist is empty or contains only narrow enduring reasons documented by an owner
- [ ] The runtime module graph has zero cycles, `purity:check` rejects cycle regressions with exact paths, and optional HTML DAG generation still works
- [ ] Backend checks/unit tests, media and fitness package tests, full standard e2e, and standalone operational gate pass
- [ ] The complete final acceptance list in the Phase 4 plan is checked against evidence and recorded
- [ ] No old status, failed-gate, deleted-module, admin-install, or backup-removal statement contradicts current plans

## User stories addressed

- User story 43
- User story 44
- User story 45
- User story 46
- User story 47
- User story 48
- User story 49
