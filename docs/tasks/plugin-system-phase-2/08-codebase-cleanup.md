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

Pay particular attention to stale registry ownership, test-only installation seams, removed
authoring surfaces, notification formatter ownership, schema terminology, interim storage
transitions, and stale `AGENTS.md`/`README.md` references pointing at moved code. Confirm no
speculative loader machinery or unrelated capability surface leaked into the completed phase.

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
