# Codebase Cleanup

**Parent Plan:** [Plugin System — Phase 2](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was
introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to
duplicate code, duplicate or alias-only types, dead code, unnecessary exports, shallow
wrappers, stale support artifacts, and speculative abstractions. The cleanup is scoped to
touched files and directly affected modules, not unrelated opportunistic refactors.

Pay particular attention to residue of the deleted `builtins` module (`registry.ts`, `seed.ts`,
definition files, old sandbox-script layout), the removed Phase 1 temporary `testSupport`
definition installer and god-mode script endpoints, any interim additive columns or coexistence
code left over from the task-02 → task-03 storage transition, and stale `CLAUDE.md`/`README.md`
references pointing at moved code (single-owner rule; cross-phase invariant 7). Confirm no
Phase 3 manifest sections (`crons`, `operations`, `workflows`, `capabilities`) or speculative
loader machinery leaked in (cross-phase invariants 3 and 5).

## Acceptance criteria

- [ ] The task is executed using the `codebase-cleanup` skill
- [ ] The cleanup pass covers all files touched by this plan and any directly affected modules
- [ ] Any removals or simplifications are reflected in the changed code before the plan is
      considered complete
