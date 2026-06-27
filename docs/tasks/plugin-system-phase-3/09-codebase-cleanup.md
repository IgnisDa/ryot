# Codebase Cleanup

**Parent Plan:** [Plugin System — Phase 3: Capability Migrations](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was
introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to
duplicate code, duplicate or alias-only types, dead code, unnecessary exports, shallow wrappers,
stale support artifacts, and speculative abstractions. The cleanup is scoped to touched files and
directly affected modules, not unrelated opportunistic refactors.

Pay particular attention to residue of the five deleted native domain modules (`media-trending`,
`exercises`, `metadata-lookup`, `episode-resolver`, `media-monitoring`), the deleted native
sink/yank + import-source adapters, the temporary step-2 `invokeOperation` scaffolding, and any
Promise-based sandbox driver/host compatibility wrapper or alias left after the Effect-native
cutover.

## Acceptance criteria

- [ ] The task is executed using the `codebase-cleanup` skill
- [ ] The cleanup pass covers all files touched by this plan and any directly affected modules
- [ ] Any removals or simplifications are reflected in the changed code before the plan is
      considered complete
