# Codebase Cleanup

**Parent Plan:** [Episodic Sub-Entity Model](./README.md)

**Type:** AFK

**Status:** done

## What to build

Review every file touched during this plan and remove anything that is no longer
needed or was introduced as scaffolding. Follow the `codebase-cleanup` skill, with
special attention to duplicate code, duplicate or alias-only types, dead code,
unnecessary exports, shallow wrappers, stale support artifacts, and speculative
abstractions. The cleanup is scoped to touched files and directly affected
modules, not unrelated opportunistic refactors.

This explicitly includes **transition-verification tests**: any test added during
this plan whose sole purpose is to assert that now-removed logic is gone — for
example a dedicated test that `show`/`podcast` no longer exposes a `progress`
event, or that the old `showSeasons`/`episodes` blob is absent. Once the migration
has landed, those assert a permanent non-fact and are pure scaffolding, so remove
them. Do NOT remove assertions that pin current desired behavior (e.g. that show
progress now records against the episode entity) or regression guards for
still-valid behavior (e.g. that anime/manga tracking is unchanged); where a single
behavior test mixes a positive assertion with an "old logic is gone" assertion,
keep the test and drop the obsolete sub-assertion only if it adds nothing.

## Acceptance criteria

- [x] The task is executed using the `codebase-cleanup` skill
- [x] The cleanup pass covers all files touched by this plan and any directly affected modules
- [x] Any removals or simplifications are reflected in the changed code before the plan is considered complete
- [x] Transition-verification tests (added only to confirm old logic was removed) are deleted, while behavior tests and regression guards for still-valid behavior are retained
