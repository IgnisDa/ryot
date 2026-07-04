# Remove the Per-User Sandbox-Script Feature

**Parent Plan:** [Plugin System — Phase 2](./README.md)

**Type:** AFK

**Status:** done

## Before you start

Read `docs/plans/plugin-system/00-overview.md` (Decision 19) and
`docs/plans/plugin-system/02-phase-2-plugin-contract-and-loader.md` §8 in full. They are the authoritative spec; this task file only frames the slice. Honor the
plan markers (`[DECIDED]`/`[RECOMMENDED]`/`[IMPLEMENTER-DECIDES]`) as described in the parent
PRD. Per `AGENTS.md`, launch an `explore` subagent first — the `sandbox` contract group and
its consumers, the authoring service/routes in `apps/app-backend/src/modules/sandbox`, the
current `sandbox_script` storage, and the
`tests/src/tests/sandbox/` suites and any fixture still compiling through the authenticated
script-creation API. **Depends on task 04** — until `installTestPlugin` exists, the e2e
provider tests depend on the script-creation API this task deletes.
Also depends on task 06, which establishes notification-script ownership before this task finalizes
script storage.

## What to build

Delete the per-user standalone script feature so plugins are the single extension mechanism
(Decision 19), keeping execution machinery intact:

1. **Contract**: remove the `sandbox` group's script authoring/CRUD/compile endpoints; audit
   what remains in the group and keep or relocate only what the plugin machinery genuinely
   needs (`[IMPLEMENTER-DECIDES]`, recorded in the plan).
2. **Backend**: delete the user-facing authoring service/routes and owner-based access checks
   in `modules/sandbox`; the execution services and `modules/sandbox/compiler.ts` survive
   (ingestion is now their consumer).
3. **Storage end state**: every script row is owned by an installed plugin or kernel source zero.
   Drop `userId` and per-user slug uniqueness; require `pluginSlug` for plugin scripts and permit
   NULL only for immutable, content-addressed source-zero scripts; regenerate the initial
   migration. Retain the `sandbox_script` table name. `entity.sandboxScriptId` provenance and
   per-_executing_-user cache isolation are unchanged.
4. **E2e**: port `tests/src/tests/sandbox/` execution-semantics/limits/fault coverage to
   scripts installed via `installTestPlugin`; delete authoring-CRUD coverage; no fixture may
   compile through the script-creation API afterwards.
5. **Docs**: update the "Sandbox Scripts" and cache sections of `apps/app-backend/AGENTS.md`
   and the sandbox-runtime README where they describe user-authored scripts.

Full spec: plan §8. Do not restate or re-derive it.

## Acceptance criteria

- [x] The `sandbox` contract group exposes no script authoring/CRUD/compile surface; any
      retained endpoints are justified and recorded in the plan (done criterion 6)
- [x] Every script row is owned by an installed plugin or kernel source zero (`pluginSlug` is
      nullable only for immutable, content-addressed source-zero rows; no `userId` column or
      per-user slug uniqueness); migration regenerated (done criterion 6)
- [x] Execution machinery, compiler service, `entity.sandboxScriptId` provenance, and
      per-executing-user cache isolation are unchanged (Decision 19)
- [x] Sandbox execution/limits/fault e2e coverage runs against plugin-installed scripts;
      authoring-CRUD coverage is deleted; no fixture uses the script-creation API (done
      criterion 6)
- [x] `apps/app-backend/AGENTS.md` and sandbox-runtime README no longer describe
      user-authored scripts (cross-phase invariant 7)
- [x] Backend `check` + unit tests, e2e suite, and `app-client` check pass (cross-phase
      invariant 1)

## User stories addressed

- User story 35
- User story 36
- User story 37
