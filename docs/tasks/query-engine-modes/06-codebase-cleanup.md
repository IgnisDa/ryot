# Codebase Cleanup

**Parent Plan:** [Query Engine Modes](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to duplicate code, duplicate or alias-only types, dead code, unnecessary exports, shallow wrappers, stale support artifacts, and speculative abstractions. The cleanup is scoped to touched files and directly affected modules, not unrelated opportunistic refactors.

Key areas to focus on:

- The query engine module (all files): look for dead code paths from before the mode refactoring, unused type exports, redundant helpers
- The media module: ensure repository.ts is removed or minimized after migration, check for orphaned helper functions
- The shared views library: check for unused reference helpers or validators that became dead code after the rename
- Test files: remove duplicated test setup, consolidate shared fixtures
- Ensure extracted CTE helpers are not duplicated between query-builder.ts and the new builders

## Acceptance criteria

- [ ] The task is executed using the `codebase-cleanup` skill
- [ ] The cleanup pass covers all files touched by this plan and any directly affected modules
- [ ] Any removals or simplifications are reflected in the changed code before the plan is considered complete
