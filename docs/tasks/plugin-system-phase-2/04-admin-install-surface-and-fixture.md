# Admin Install Surface and Real-Loader Test Fixture

**Parent Plan:** [Plugin System — Phase 2](./README.md)

**Type:** AFK

**Status:** todo

## Before you start

Read `docs/plans/plugin-system/00-overview.md` and
`docs/plans/plugin-system/02-phase-2-plugin-contract-and-loader.md` in full before writing any
code. They are the authoritative spec; this task file only frames the slice. Honor the plan
markers (`[DECIDED]`/`[RECOMMENDED]`/`[IMPLEMENTER-DECIDES]`) as described in the parent PRD.
Per `AGENTS.md`, launch an `explore` subagent first — the existing provider fixture
(`tests/src/fixtures/sandbox-provider.ts`: `seedBuiltinProviderScript`, `promoteSandboxScript`,
`cleanupBuiltinProviderScript`, `patchSandboxScript`) and its `fakeProvider*` builders, the
Phase 1 temporary `testSupport` in-memory definition installer, the god-mode contract group,
and admin-scoping conventions in the contract. Depends on task 03 (boot cutover).

## What to build

Expose the real loader through an admin surface and make the entire e2e suite run against it,
replacing every test-only injection seam:

1. **Admin `plugins` contract group** — `install` (upload a source bundle; format is
   `[IMPLEMENTER-DECIDES]`: tar/zip of the package or a JSON file map — pick the simplest and
   record it), `uninstall`, `list`. This is the only plugin API surface (Decision 9 — no
   plugin-specific typed endpoints). Uninstall policy v1 (`[RECOMMENDED]`): refuse while any
   entity rows reference the plugin's schemas; first-party plugins are not uninstallable while
   referenced by boot config.
2. **`installTestPlugin` fixture** — assemble a tiny in-memory plugin source (manifest + one
   provider script built from the same `fakeProvider*` builders), install through the real
   endpoint, uninstall in cleanup. Replace `seedBuiltinProviderScript` /
   `cleanupBuiltinProviderScript` so every provider-driven e2e test exercises the real loader
   implicitly.
3. **Remove the seams**: delete the `testSupport.promoteSandboxScript` / `deleteSandboxScript`
   god-mode endpoints, and replace every Phase 1 use of the temporary `testSupport` in-memory
   definition installer with test plugin source installed via `installTestPlugin`, then delete
   that installer endpoint and its registry-mutation helper. Phase 2 is not complete while any
   fixture references the temporary seam. Port the fixture's driver-fault-injection ability
   (`patchSandboxScript`) to reinstall-with-modified-source.

Full spec: plan §6 (install surface, fixture, seam removal) and §7 (hot-install e2e). Do not
restate or re-derive it.

## Acceptance criteria

- [ ] Admin `plugins` group provides `install`/`uninstall`/`list`; no plugin-specific typed
      contract endpoints are added (Decision 9)
- [ ] Uninstall is refused while entity rows reference the plugin's schemas, under test (plan
      §6, §7)
- [ ] Hot-install e2e passes: install a fake plugin → search/import through it → uninstall
      (done criterion 4)
- [ ] `promoteSandboxScript`/`deleteSandboxScript` and the Phase 1 temporary `testSupport`
      definition installer + its registry-mutation helper are gone from `tests/` and the
      contract; no fixture references the temporary seam (done criterion 3)
- [ ] `installTestPlugin` replaces the provider fixture and `patchSandboxScript` is ported to
      reinstall-with-modified-source; the full e2e suite is green using the new fixture (done
      criterion 3)
- [ ] A deliberately corrupted plugin source fails ingestion/boot with a structured error, under
      unit/integration test (done criterion 5)
- [ ] `[IMPLEMENTER-DECIDES]` bundle-format choice is recorded in the plan; backend `check` +
      unit tests, e2e suite, and `app-client` check pass (cross-phase invariant 1)

## User stories addressed

- User story 26
- User story 27
- User story 28
- User story 29
- User story 30
- User story 31
- User story 32
