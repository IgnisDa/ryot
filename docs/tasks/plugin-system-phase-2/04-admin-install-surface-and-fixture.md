# Admin Install Surface and Real-Loader Test Fixture

**Parent Plan:** [Plugin System — Phase 2](./README.md)

**Type:** AFK

**Status:** done

## Before you start

Read `docs/plans/plugin-system/00-overview.md` and
`docs/plans/plugin-system/02-phase-2-plugin-contract-and-loader.md` in full before writing any
code. They are the authoritative spec; this task file only frames the slice. Honor the plan
markers (`[DECIDED]`/`[RECOMMENDED]`/`[IMPLEMENTER-DECIDES]`) as described in the parent PRD.
Per `AGENTS.md`, launch an `explore` subagent first — inspect the existing provider fixture,
its `fakeProvider*` builders, the real-loader install path, and admin-scoping conventions in the
contract. Depends on task 03 (boot cutover).

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
   endpoint, and uninstall in cleanup. Every provider-driven e2e test exercises the real loader.
3. **Use the real loader everywhere**: provider fixtures install plugin source instead of mutating
   an in-memory registry. Reinstall modified source when tests need fault injection.

Full spec: plan §6 (install surface, fixture, seam removal) and §7 (hot-install e2e). Do not
restate or re-derive it.

## Acceptance criteria

- [x] Admin `plugins` group provides `install`/`uninstall`/`list`; no plugin-specific typed
      contract endpoints are added (Decision 9)
- [x] Uninstall is refused while entity rows reference the plugin's schemas, under test (plan
      §6, §7)
- [x] Hot-install e2e passes: install a fake plugin → search/import through it → uninstall
      (done criterion 4)
- [x] `installTestPlugin` replaces the provider fixture and modified-source reinstall supports
      fault injection; the full e2e suite is green using the real loader (done criterion 3)
- [x] A deliberately corrupted plugin source fails ingestion/boot with a structured error, under
      unit/integration test (done criterion 5)
- [x] `[IMPLEMENTER-DECIDES]` bundle-format choice is recorded in the plan; backend `check` +
      unit tests, e2e suite, and `app-client` check pass (cross-phase invariant 1)

## User stories addressed

- User story 26
- User story 27
- User story 28
- User story 29
- User story 30
- User story 31
- User story 32
