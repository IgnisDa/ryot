# Codebase Cleanup

**Parent Plan:** [Plugin System — Phase 2](./README.md)

**Type:** AFK

**Status:** done

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was
introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to
duplicate code, duplicate or alias-only types, dead code, unnecessary exports, shallow
wrappers, stale support artifacts, and speculative abstractions. The cleanup is scoped to
touched files and directly affected modules, not unrelated opportunistic refactors.

Pay particular attention to residue of the deleted `builtins` module (`registry.ts`, `seed.ts`,
definition files, old sandbox-script layout), the removed Phase 1 temporary `testSupport`
definition installer and god-mode script endpoints, residue of the removed per-user
sandbox-script feature (task 07 / Decision 19: authoring routes, owner-based access checks,
orphaned contract schemas, sandbox e2e authoring fixtures), notification formatter ownership
(task 06: no media/fitness vocabulary or formatter remains in kernel source), residue of the removed tracker
concept (task 03 / Decision 20: `tracker`-named types, fixtures, contract schemas, or
`trackerSlug` references), any interim additive columns or
coexistence code left over from the task-02 → task-03 storage transition, and stale
`AGENTS.md`/`README.md` references pointing at moved code (single-owner rule; cross-phase
invariant 7). Confirm no
Phase 3 manifest sections (`crons`, `operations`, `workflows`, `capabilities`) or speculative
loader machinery leaked in (cross-phase invariants 3 and 5).

## Acceptance criteria

- [x] The task is executed using the `codebase-cleanup` skill
- [x] The cleanup pass covers all files touched by this plan and any directly affected modules
- [x] Any removals or simplifications are reflected in the changed code before the plan is
      considered complete

## Verification

- `bun turbo --filter=@ryot/app-backend check` passed.
- `cd apps/app-backend && bun run test` passed (932 tests).
- The full e2e run was aborted after timeout failures in
  `media-monitoring/association-detectors.test.ts` and `sandbox/cache.test.ts`; it was not rerun
  at the owner's request.
