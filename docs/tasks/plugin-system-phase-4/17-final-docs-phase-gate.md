# Final Architecture Documentation and Phase Gate

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** done

## What to build

Bring all owning documentation and the Phase 4 acceptance record in line with the implemented final
architecture. Read the overview, Phase 4 plan, parent PRD, and this task first.

Complete the plugin authoring reference, sandbox runtime reference, test ownership/fixture/budget
conventions, module ownership notes, plan decision records, performance measurements, and known
exceptions under the single-owner rule. Retain the backup client, add the owner-requested deletion
TODO to every affected backup/dependent file, and remove its contract purity exception by relocating
required media types into the backup app. Then record the full Phase 4 acceptance matrix before
cleanup. Retain the module dependency analysis as a
non-rendering purity check, resolve the existing runtime cycles, and wire zero-cycle enforcement into
`purity:check` without a baseline allowlist. The former HTML renderer is intentionally removed.

## Acceptance criteria

- [x] Plugin authoring docs cover manifest sections, script kinds, providers, entrypoints, authority, capabilities, caches, determinism, and batch-first guidance
- [x] Sandbox docs cover file modules, host functions, grants, bridge concurrency, workflows, limits, liveness, and private Promise interop
- [x] Test docs describe the kernel/media/fitness tree, fixture lifecycle, standalone operational gate, and final pool arithmetic
- [x] Added/deleted/changed modules have one authoritative ownership document with no stale duplicate facts
- [x] Phase plans record implementation decisions, deviations, measurements, and Phase 5 deferrals accurately
- [x] Every affected backup/dependent file contains the requested future-deletion TODO and the backup remains present
- [x] Purity allowlist contains only the narrow enduring legacy-bootstrap and boot-wiring reasons documented by the owner
- [x] The runtime module graph has zero cycles and `purity:check` rejects cycle regressions with exact paths
- [x] Backend checks/unit tests, media and fitness package tests, and full standard e2e pass; the owner explicitly waived the Task 17 operational gate, which was not run, and the live gate remains excluded
- [x] The complete final acceptance list in the Phase 4 plan is checked against evidence and recorded
- [x] No old status, failed-gate, deleted-module, admin-install, or backup-removal statement contradicts current plans

## Completion record

The shared non-rendering runtime analyzer is the sole cycle-analysis consumer and produces exact,
deterministic diagnostics. Auth/user-bootstrap hook separation, integration operation-scope hook
separation, and sandbox plugin-script resolver hook/layer wiring broke all 13 baseline runtime cycles
while preserving behavior. Per explicit owner direction, the HTML module-DAG renderer was removed.

`purity:check` passed over 316 production files and 869 terms with zero runtime cycles. Its 1,403
justified allowlisted occurrences are 1,397 `legacy-bootstrap`, three fitness boot-wiring, and three
media boot-wiring occurrences. Moving media types into retained `app-client-backup` removed the backup
contract exception; future-deletion TODOs were added to its four affected local files:
`media-types.ts`, `model.ts`, `model.test.ts`, and `types.ts`.

Focused runtime-analysis tests passed 2 tests. The backend check passed. Backend tests passed 140
files and 978 tests; media tests passed 95 files and 379 tests; fitness tests passed 13 files and 43
tests. Standard e2e passed 81 files and 511 tests through individual file invocations with zero
failures in 1,888.26 seconds. The owner explicitly waived the Task 17 operational gate, so it was not
run and no pass is claimed. The live-network gate remained excluded.

Final acceptance evidence for all 10 Phase 4 criteria is recorded in the owning Phase 4 plan. It
references Tasks 01-16 for previously completed purity, ownership, lifecycle, Effect boundary, import,
bootstrap, uninstall, and GC criteria and this task for final docs, verification, and cycle closure.
Phase 5 user-level installation and related trust, namespace, consent, quota, and distribution work
remain deferred. Task 18 is next.

## User stories addressed

- User story 43
- User story 44
- User story 45
- User story 46
- User story 47
- User story 48
- User story 49
