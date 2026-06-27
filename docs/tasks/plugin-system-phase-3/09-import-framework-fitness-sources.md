# Step 4c — Import Framework Collapse + Fitness Import Sources

**Parent Plan:** [Plugin System — Phase 3: Capability Migrations](./README.md)

**Type:** AFK

**Status:** done

## What to build

Before starting, read `docs/plans/plugin-system/00-overview.md` in full and then
`docs/plans/plugin-system/03-phase-3-capability-migrations.md` in full — §4 is the authoritative
spec. Do not begin until Step 4b (task 08) is done and its gates pass.

This task proves the generic import dispatch path on the three simplest adapters before task 10
lands sixteen media sources on it. Fitness before media is deliberate.

Move the fitness import sources into `plugins/fitness` as an import workflow plus adapter scripts
declared through the `importSources` manifest section:

- `hevy` (CSV workouts), `strong-app` (CSV workouts), `open-scale` (CSV measurements).

`plugins/fitness` has no import surface today, so it gains one: a workflow the kernel dispatches,
adapter scripts that parse the artifact inside the sandbox using the granted `artifact-read`
capability and `papaparse`, and chunk output written to the granted scratch directory. The kernel
harvests the chunks and performs **all** entity, event, and relationship writes — the plugin parses
and orchestrates, it never writes.

Complete the kernel-side collapse task 07 started:

- Delete `imports/non-media-workflow.ts`, `imports/non-media-operation-registry-workflow.ts`,
  `imports/workout/`, `imports/measurement/`, and the three fitness adapters under
  `imports/sources/`.
- Reduce `imports/runtime/{import-files,csv,source-definitions}.ts` to whatever the framework still
  needs once parsing lives in the sandbox and the source table lives in manifests.

Move the fitness adapter unit tests into `plugins/fitness` with assertions preserved. Re-point the
OpenScale and Hevy e2e coverage in `tests/src/tests/imports/imports.test.ts` (8 of its 9 tests)
with assertions preserved — including the partial-completion and per-row failure-message
assertions, which are the behavioral spec for failure reporting through the new path.

## Acceptance criteria

- [x] `hevy`, `strong-app`, and `open-scale` run as `plugins/fitness` import adapters declared
      through `importSources`, parsing inside the sandbox via `artifact-read` + `papaparse`
- [x] Adapter output crosses via scratch-dir chunk files plus a small return manifest; the kernel
      harvests it and performs every entity/event/relationship write
- [x] One registry-driven import dispatch path remains; the non-media orchestration, `workout/`,
      and `measurement/` directories are deleted
- [x] `imports/runtime/` retains no fitness parsing or source metadata; task 10 owns the remaining
      media fallback table
- [x] Fitness adapter unit tests live in `plugins/fitness` with assertions preserved
- [x] OpenScale and Hevy e2e coverage re-pointed with assertions preserved, including partial
      completion and per-row failure messages
- [x] Backend `check` + unit tests, affected e2e coverage, and the `app-client` check pass; the owner
      will run the full e2e suite (cross-phase invariant 1)

## User stories addressed

- User story 27
- User story 29
- User story 30
- User story 38
- User story 39
- User story 43
- User story 44
- User story 45
