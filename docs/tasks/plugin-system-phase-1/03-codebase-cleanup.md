# Codebase Cleanup

**Parent Plan:** [Plugin System — Phase 1: Schema Registry](./README.md)

**Type:** AFK

**Status:** todo

## Required reading (do this first)

Before starting, read `docs/plans/plugin-system/00-overview.md` and
`docs/plans/plugin-system/01-phase-1-schema-registry.md` in full so the cleanup respects the
Phase 1 done criteria and cross-phase invariants (especially invariant 7, "documentation
follows the code"). Also read the parent [README.md](./README.md).

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was
introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to
duplicate code, duplicate or alias-only types, dead code, unnecessary exports, shallow
wrappers, stale support artifacts, and speculative abstractions. The cleanup is scoped to
touched files and directly affected modules, not unrelated opportunistic refactors.

Phase 1 specifics to watch for: leftover references to the dropped definition tables or
`…SchemaId` columns; dead helpers or exports stranded by the deleted schema/tracker CRUD
modules and contract groups; now-unused fixtures or `test-support` surfaces after the e2e
re-plumb; any transitional dual-source code left over from landing the registry (task 01)
before the cutover (task 02); and `CLAUDE.md`/`AGENTS.md`/`README.md` facts that should have
moved rather than been duplicated.

## Acceptance criteria

- [ ] The task is executed using the `codebase-cleanup` skill
- [ ] The cleanup pass covers all files touched by this plan and any directly affected modules
- [ ] Any removals or simplifications are reflected in the changed code before the plan is
      considered complete
- [ ] The Phase 1 gate still passes after cleanup:
      `bun turbo --filter=@ryot/app-backend check`, backend unit tests, the e2e suite (minus
      deleted files), and the `app-client` check
