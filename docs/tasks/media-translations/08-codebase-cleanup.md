# Codebase Cleanup

**Parent Plan:** [Media Translations](./README.md)

**Type:** AFK

**Status:** done

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was
introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to duplicate
code, duplicate or alias-only types, dead code, unnecessary exports, shallow wrappers, stale support
artifacts, and speculative abstractions. The cleanup is scoped to touched files and directly
affected modules, not unrelated opportunistic refactors.

## Acceptance criteria

- [x] The task is executed using the `codebase-cleanup` skill
- [x] The cleanup pass covers all files touched by this plan and any directly affected modules
- [x] Any removals or simplifications are reflected in the changed code before the plan is considered complete

## Implementation Notes

- Removed unused and unnecessary translation-module exports, including internal helper result
  types and the workflow payload schema/type.
- Simplified `TranslationsRepository.upsertOverlay` so it no longer returns an unused id, and
  stopped selecting `entity_translation.populatedAt` on overlay reads where only merge fields are
  needed.
- Removed the shallow built-in registry `provider` wrapper and consolidated repeated translated
  provider metadata assertions into a table-driven check.
- Moved reusable translation e2e setup helpers into `tests/src/fixtures/translations.ts`, making
  `tests/src/tests/entities-translation.test.ts` shorter and focused on behavior.
- Removed the unused translation fixture polling helper and made the entity-populated marker
  private to the fixture.
- Verification was limited to static inspection and repository searches because this environment
  does not have the required Bun/Deno application dependencies.
