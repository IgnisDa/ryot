# Codebase Cleanup

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** todo

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was
introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to duplicate
code, duplicate or alias-only types, dead code, unnecessary exports, shallow wrappers, stale support
artifacts, obsolete activity/standard-runtime terminology, temporary compatibility, and speculative
abstractions. The cleanup is scoped to touched files and directly affected modules, not unrelated
opportunistic refactors.

## Acceptance criteria

- [ ] The task is executed using the `codebase-cleanup` skill.
- [ ] The cleanup pass covers all files touched by this plan and any directly affected modules.
- [ ] Any removals or simplifications are reflected in the changed code before the plan is considered
      complete.
- [ ] No temporary Phase 1 compatibility, tracer-only production branch, stale activity terminology,
      or duplicate execution path remains.
- [ ] Relevant package checks/tests and affected E2E remain green after cleanup.
