# Codebase Cleanup

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** todo

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was
introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to duplicate
code, duplicate or alias-only types, dead code, unnecessary exports, shallow wrappers, stale support
artifacts, and speculative abstractions. The cleanup is scoped to touched files and directly affected
modules, not unrelated opportunistic refactors.

Remove temporary purity exceptions, obsolete native library names and wrappers, compatibility
re-exports, dead provenance scaffolding, stale generated assumptions, resolved migration comments,
and task-only fixtures. Preserve useful negative tests, private platform adapters, and intentional
Phase 5 deferrals. Re-run the complete Phase 4 verification matrix after cleanup.

## Acceptance criteria

- [ ] The task is executed using the `codebase-cleanup` skill
- [ ] The cleanup pass covers all files touched by this plan and any directly affected modules
- [ ] Any removals or simplifications are reflected in the changed code before the plan is considered complete
- [ ] No temporary compatibility path, task-linked purity exception, dead wrapper, or speculative Phase 5 abstraction remains
- [ ] The backup client and its owner-requested deletion TODOs remain intact
- [ ] Backend checks/unit tests, plugin package tests, standard e2e, and standalone operational gate pass after cleanup

## User stories addressed

- User story 53
