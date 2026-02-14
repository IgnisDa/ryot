# Codebase Cleanup

**Parent Plan:** [Exercises Support in Ryot V2](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to duplicate code, duplicate or alias-only types, dead code, unnecessary exports, shallow wrappers, stale support artifacts, and speculative abstractions. The cleanup is scoped to touched files and directly affected modules, not unrelated opportunistic refactors.

## Acceptance criteria

- [ ] The task is executed using the `codebase-cleanup` skill
- [ ] The cleanup pass covers all files touched by this plan and any directly affected modules
- [ ] Any removals or simplifications are reflected in the changed code before the plan is considered complete

