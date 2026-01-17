# Remove the Per-User Sandbox-Script Feature

**Parent Plan:** [Plugin System — Phase 2](./README.md)

**Type:** AFK

**Status:** todo

## Before you start

Read `docs/plans/plugin-system/00-overview.md` (Decision 19) and
`docs/plans/plugin-system/02-phase-2-plugin-contract-and-loader.md` §8 in full. They are the authoritative spec; this task file only frames the slice. Honor the
plan markers (`[DECIDED]`/`[RECOMMENDED]`/`[IMPLEMENTER-DECIDES]`) as described in the parent
PRD. Per `AGENTS.md`, launch an `explore` subagent first — the `sandbox` contract group and
its consumers, the authoring service/routes in `apps/app-backend/src/modules/sandbox`, the
`sandbox_script` storage as tasks 02–03 actually left it, and the
`tests/src/tests/sandbox/` suites and any fixture still compiling through the authenticated
script-creation API. **Depends on task 04** — until `installTestPlugin` exists, the e2e
provider tests depend on the script-creation API this task deletes.

## What to build

Delete the per-user standalone script feature so plugins are the single extension mechanism
(Decision 19), keeping execution machinery intact:

1. **Contract**: remove the `sandbox` group's script authoring/CRUD/compile endpoints; audit
   what remains in the group and keep or relocate only what the plugin machinery genuinely
   needs (`[IMPLEMENTER-DECIDES]`, recorded in the plan).
2. **Backend**: delete the user-facing authoring service/routes and owner-based access checks
   in `modules/sandbox`; the execution services and `modules/sandbox/compiler.ts` survive
   (ingestion is now their consumer).
3. **Storage end state**: every script row plugin-owned — `pluginSlug` NOT NULL, `userId`
   dropped, per-user slug uniqueness gone; regenerate the initial migration. Table rename
   (e.g. `plugin_script`) is `[IMPLEMENTER-DECIDES]`. `entity.sandboxScriptId` provenance and
   per-*executing*-user cache isolation are unchanged.
4. **E2e**: port `tests/src/tests/sandbox/` execution-semantics/limits/fault coverage to
   scripts installed via `installTestPlugin`; delete authoring-CRUD coverage; no fixture may
   compile through the script-creation API afterwards.
5. **Docs**: update the "Sandbox Scripts" and cache sections of `apps/app-backend/CLAUDE.md`
   and the sandbox-runtime README where they describe user-authored scripts.

Full spec: plan §8. Do not restate or re-derive it.

## Acceptance criteria

- [ ] The `sandbox` contract group exposes no script authoring/CRUD/compile surface; any
      retained endpoints are justified and recorded in the plan (done criterion 6)
- [ ] Every script row is plugin-owned (`pluginSlug` NOT NULL, no `userId` column, no
      per-user slug uniqueness); migration regenerated (done criterion 6)
- [ ] Execution machinery, compiler service, `entity.sandboxScriptId` provenance, and
      per-executing-user cache isolation are unchanged (Decision 19)
- [ ] Sandbox execution/limits/fault e2e coverage runs against plugin-installed scripts;
      authoring-CRUD coverage is deleted; no fixture uses the script-creation API (done
      criterion 6)
- [ ] `apps/app-backend/CLAUDE.md` and sandbox-runtime README no longer describe
      user-authored scripts (cross-phase invariant 7)
- [ ] Backend `check` + unit tests, e2e suite, and `app-client` check pass (cross-phase
      invariant 1)

## User stories addressed

- User story 35
- User story 36
- User story 37
