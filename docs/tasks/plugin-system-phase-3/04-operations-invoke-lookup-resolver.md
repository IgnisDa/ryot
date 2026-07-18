# Step 2 — Operations/invoke: metadata-lookup + episode-resolver

**Parent Plan:** [Plugin System — Phase 3: Capability Migrations](./README.md)

**Type:** AFK

**Status:** done

## What to build

Before starting, read `docs/plans/plugin-system/00-overview.md` in full and then
`docs/plans/plugin-system/03-phase-3-capability-migrations.md` in full. Do not begin until Step 1
(task 03) is done. This slice implements plan §2 end-to-end: kernel capability first, then the
plugin operations that consume it, then delete the native modules and re-point the suites.

Kernel capability (lands before consumers):

- Add the `operations: [{ slug, driverRef, inputSchema, outputSchema, auth }]` manifest section
  (`auth` = authenticated-user vs admin; schemas use the SDK's Effect Schema contract style).
- Add exactly one new contract endpoint, `plugins.invoke(pluginSlug, operationSlug, payload)`,
  that validates the payload against the declared schemas, dispatches to the driver, and returns
  the result — batch-first payloads. The static typed contract (`libs/contract`) grows no
  plugin-specific endpoints (Decision 9).
- First-party client typing ("recipes"): the plugin package exports its operation input/output
  types and clients call `invoke` through a small typed wrapper in `libs/plugin-kit`
  (`[RECOMMENDED]`).

Migration:

- `modules/metadata-lookup` → media-plugin operations. Migrate the browser extension
  (`apps/browser-extension`) in this same step to the invoke endpoint — it is the sole external
  consumer (`app-client` has none).
- `modules/episode-resolver` → media plugin. Its consumers are mostly internal
  (import/integration flows migrating in steps 3–4), so kernel code that still needs episode
  resolution calls the operation through an internal `invokeOperation` service function (same
  dispatch path, no HTTP). This is explicitly temporary scaffolding that the later steps remove.
- Delete both modules and the `metadata-lookup` contract group (the `media-monitoring` group
  survives until step 5).

See the parent PRD "Step 2 — operations (invoke)" user stories and the Implementation Decisions
"Step 2" pointer for the full spec.

## Acceptance criteria

Derived from the plan §2 done criteria and cross-phase invariants:

- [x] `operations` manifest section and the single `plugins.invoke` endpoint exist; the endpoint
      validates against declared input/output schemas, enforces `auth`, and dispatches to the
      driver; the static contract has no plugin-specific endpoints
- [x] Kernel tests cover the invoke endpoint: schema validation, auth, and unknown operation
- [x] `modules/metadata-lookup` and `modules/episode-resolver` are deleted, along with the
      `metadata-lookup` contract group; internal episode-resolution callers use the temporary
      `invokeOperation` service path
- [x] The browser extension works against the invoke endpoint; metadata-lookup /
      browser-extension integration suites are re-pointed with assertions preserved
- [x] The branch stays shippable: backend `check` + unit tests and the `app-client` /
      `browser-extension` checks pass; the e2e suite is green for everything this step touches
      (a new `tests/src/tests/kernel/plugins/operations.test.ts` covers dispatch, unknown plugin/operation,
      input-schema violation, and declared-auth enforcement). **Resolved as a task-03 follow-up:**
      `tests/src/tests/plugins/fitness/workout-templates.test.ts` and `tests/src/tests/plugins/fitness/workouts.test.ts`
      had no exercise-seeding source once task 03 moved exercise preload behind a manual cron trigger
      that only `exercises.test.ts` / `god-mode/cron-trending.test.ts` called; `waitForSeededExerciseIds`
      polled but nothing seeded the catalog. The fix moves exercise preload off the periodic `crons`
      section onto a new one-time-per-server-start `boot` section (task 03 amendment, 2026-07-26), so
      the e2e backend seeds exercises at startup like every other environment and the workout fixtures
      need no cron trigger.

## User stories addressed

- User story 11
- User story 12
- User story 13
- User story 14
- User story 15
- User story 16
- User story 37
- User story 38
- User story 39
