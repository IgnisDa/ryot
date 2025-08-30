# Codebase Cleanup

**Parent Plan:** [God Mode Auth Recovery](./README.md)

**Type:** AFK

**Status:** done

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to duplicate code, duplicate or alias-only types, dead code, unnecessary exports, shallow wrappers, stale support artifacts, and speculative abstractions. The cleanup is scoped to touched files and directly affected modules, not unrelated opportunistic refactors.

## Acceptance criteria

- [x] The task is executed using the `codebase-cleanup` skill
- [x] The cleanup pass covers all files touched by this plan and any directly affected modules
- [x] Any removals or simplifications are reflected in the changed code before the plan is considered complete

## Cleanup summary

- Removed dead `UserListResponse` type alias from `schemas.ts` (never consumed)
- Removed unnecessary barrel exports of `CheckResetEligibilityDeps`, `GodModeServiceResult`, `ListUsersDeps` from `index.ts` (internal only, no external consumers)
- Removed unused `email` destructured variables in `auth-god-mode-recovery.test.ts` (lines 251, 265)
- Verified no other dead code, duplicate types, or shallow wrappers exist in touched files
