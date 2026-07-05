# Step 2 — Operations/invoke: metadata-lookup + episode-resolver

**Parent Plan:** [Plugin System — Phase 3: Capability Migrations](./README.md)

**Type:** AFK

**Status:** todo

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

- [ ] `operations` manifest section and the single `plugins.invoke` endpoint exist; the endpoint
      validates against declared input/output schemas, enforces `auth`, and dispatches to the
      driver; the static contract has no plugin-specific endpoints
- [ ] Kernel tests cover the invoke endpoint: schema validation, auth, and unknown operation
- [ ] `modules/metadata-lookup` and `modules/episode-resolver` are deleted, along with the
      `metadata-lookup` contract group; internal episode-resolution callers use the temporary
      `invokeOperation` service path
- [ ] The browser extension works against the invoke endpoint; metadata-lookup /
      browser-extension integration suites are re-pointed with assertions preserved
- [ ] The branch stays shippable: backend `check` + unit tests, the full e2e suite, and the
      `app-client` check all pass (cross-phase invariant 1)

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
