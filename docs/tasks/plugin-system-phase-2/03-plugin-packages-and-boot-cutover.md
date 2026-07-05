# Plugin Packages and Boot Cutover

**Parent Plan:** [Plugin System — Phase 2](./README.md)

**Type:** AFK

**Status:** todo

## Before you start

Read `docs/plans/plugin-system/00-overview.md` and
`docs/plans/plugin-system/02-phase-2-plugin-contract-and-loader.md` in full before writing any
code. They are the authoritative spec; this task file only frames the slice. Honor the plan
markers (`[DECIDED]`/`[RECOMMENDED]`/`[IMPLEMENTER-DECIDES]`) as described in the parent PRD.
Per `AGENTS.md`, launch an `explore` subagent first — the full contents of
`apps/app-backend/src/modules/builtins/` (`registry.ts`, `seed.ts`, the definition files, the
sandbox scripts, and `CLAUDE.md` semantics), the after-migrations slot in `app/layers.ts`, and
`automations/lifecycle-dispatch.ts`. Depends on tasks 01 and 02.

## What to build

This is the one deliberately large, **atomic** slice: cut the registry's definition source over
from in-kernel `builtins` code to loaded plugins. It cannot be honestly split — the registry
must be fed from exactly one source at boot.

1. **Create the plugin packages** under a top-level `plugins/` directory (`[RECOMMENDED]`):
   `plugins/media` and `plugins/fitness`, each `definePlugin` manifest + schemas + scripts +
   `shared/`. Assign content per plan §2's explicit lists (media: all media schemas/property
   schemas/saved views/trackers, the ~52 provider scripts except `exercise.free-exercise-db`,
   the named media automations and signal schemas; fitness: exercise/workout/measurement
   schemas + property schemas, fitness tracker/views, `exercise.free-exercise-db`,
   `automation.workout-created`, `workout.created`). Resolve ambiguous ownership with Decision
   2's litmus and record it in the plan (`[IMPLEMENTER-DECIDES]`).
2. **Kernel-owned "source zero" definitions** (not a plugin): the `collection` entity schema,
   the `integration.disabled` signal schema, and the generic `automation.notification` delivery
   script, contributed through the same registry mechanism.
3. **Cut boot over**: ingest kernel definitions + `plugins/media` + `plugins/fitness` before the
   server accepts traffic, replacing `SeedService`'s definition-seeding slot in `app/layers.ts`
   (plan §4 boot flow). Wire in the task-02 boot short-circuit.
4. **Move global builtin lifecycle dispatch off the DB**: `automations/lifecycle-dispatch.ts`
   and the event policy/subscription evaluation read global bindings (`userId IS NULL`) from the
   registry snapshot instead of `automation_rule` rows (plan §5 first bullet). This must move in
   this slice because the seeding is deleted here.
5. **Delete**: `entity_schema_sandbox_script` (links now come from `bindings.schemaScriptLinks`),
   `builtins/registry.ts`, `builtins/seed.ts`, the rest of the `builtins` module once emptied,
   and the `isBuiltin` column on `sandbox_script` (user scripts become `pluginSlug IS NULL`).
   `user-bootstrap` must contain no builtin materialization after this. Regenerate the single
   drizzle migration rather than authoring ALTERs.

Out of this slice: the per-user notification-subscription move and the `automation_rule` table
deletion (task 05 — the table still holds `userId`-set rows and keeps working here); the admin
install endpoint and the e2e fixture swap (task 04 — the old `promoteSandboxScript` provider
fixture still works, keeping the suite green). Move affected `CLAUDE.md` semantics with the
code (single-owner rule; cross-phase invariant 7).

Full spec: plan §2 (packages, content assignment), §4 (boot flow), §5 (global-binding
dispatch). Do not restate or re-derive it.

## Acceptance criteria

- [ ] `apps/app-backend/src/modules/builtins/` no longer exists; media/fitness definitions and
      scripts live in `plugins/media` and `plugins/fitness`; kernel-owned definitions live in
      the registry module (done criterion 1)
- [ ] Boot ingests both first-party plugins before accepting traffic; the definition registry is
      fully populated from the loader, not SeedService (done criterion 5, boot half)
- [ ] `entity_schema_sandbox_script` is gone and lifecycle dispatch is registry-driven;
      automation e2e behavior suites (auto-complete, integration progress policy, notification
      delivery) are green with assertions unchanged (done criterion 2, partial)
- [ ] `isBuiltin` on `sandbox_script` is dropped and `user-bootstrap` performs no builtin
      materialization
- [ ] The full e2e suite is green using the still-existing provider fixture (fixture swap is
      task 04); backend `check` + unit tests and `app-client` check pass (cross-phase invariant 1)
- [ ] Ambiguous plugin-vs-kernel ownership decisions are recorded in the plan; affected
      `CLAUDE.md`/`README.md` docs are moved with the code (cross-phase invariant 7)

## User stories addressed

- User story 4
- User story 6
- User story 7
- User story 15
- User story 16
- User story 17
- User story 20
- User story 24
- User story 25
- User story 33
