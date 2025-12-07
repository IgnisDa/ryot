# Codebase Cleanup

**Parent Plan:** [Query Engine Hierarchical Results PRD](./README.md)

**Type:** AFK

**Status:** done

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to duplicate code, duplicate or alias-only types, dead code, unnecessary exports, shallow wrappers, stale support artifacts, and speculative abstractions. The cleanup is scoped to touched files and directly affected modules, not unrelated opportunistic refactors. Remove the `queryDefinition` column that is now useless.

## Implementation notes

The cleanup pass removed the old saved-view `queryDefinition` persistence path end-to-end outside the
intentionally deferred app-client surface. `saved_view.queryDefinition` was removed from the Drizzle table
schema and a migration drops the physical `query_definition` column. Saved-view repository and builtin
bootstrap writes now persist only canonical `queryDocument` values.

Builtin saved views no longer carry old `queryDefinition`, `eventJoins`, or `relationshipJoins` metadata.
The media in-library behavior is represented directly as canonical query-document generation options.

The test seed script now defines saved views with canonical query documents only. The old seed-script
normalization path from query-definition shorthand to canonical documents, plus its dead filter/sort/join
helpers, was removed.

Old saved-view query-definition-only backend schemas and unused pagination exports were removed from
`display-configuration.ts`. App-client references now import the renamed display configuration export.

## Acceptance criteria

- [x] The task is executed using the `codebase-cleanup` skill
- [x] The cleanup pass covers all files touched by this plan and any directly affected modules
- [x] Any removals or simplifications are reflected in the changed code before the plan is considered complete
