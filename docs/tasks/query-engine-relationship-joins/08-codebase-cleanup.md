# Codebase Cleanup

**Parent Plan:** [Query Engine Relationship Joins](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to duplicate code, duplicate or alias-only types, dead code, unnecessary exports, shallow wrappers, stale support artifacts, and speculative abstractions. The cleanup is scoped to touched files and directly affected modules, not unrelated opportunistic refactors.

## Acceptance criteria

- [x] The task is executed using the `codebase-cleanup` skill
- [x] The cleanup pass covers all files touched by this plan and any directly affected modules
- [x] Any removals or simplifications are reflected in the changed code before the plan is considered complete

## Cleanup performed

### Removed dead code

- **`apps/app-backend/src/modules/query-engine/loaders.ts`**: Removed `validateRelationshipSlugs` (only used in tests, never in production) and `loadVisibleRelationshipSchemas` (exported but never imported anywhere).
- **`apps/app-backend/src/modules/query-engine/loaders.test.ts`**: Removed the `validateRelationshipSlugs` test block since the function was deleted.
- **`tests/src/fixtures/relationships.ts`**: Deleted the entire file; its exports (`createRelationshipSchema`, `createRelationshipRow`) were never imported anywhere.
- **`apps/app-backend/src/modules/query-engine/schemas.ts` & `index.ts`**: Removed unused `QueryEngineResolvedField` type export.

### Removed duplicate code

- **`apps/app-backend/src/modules/query-engine/relationship-join-ctes.ts`**: Removed duplicate `getRelationshipJoinCteName` and `getRelationshipJoinColumnName` exports; they already existed in `sql-expression-helpers.ts` and are now imported from there.
- **`apps/app-backend/src/modules/query-engine/filter-builder.ts` & `sort-builder.ts`**: Extracted identical `createDefaultCompiler` functions into a shared `createDefaultCompiler` helper exported from `expression-compiler.ts`.
- **`apps/app-backend/src/modules/query-engine/loaders.ts`**: Refactored `loadVisibleRelationshipJoins` to call `validateVisibleRelationshipSchemaRows` instead of inlining the same slug validation logic.
- **`tests/src/fixtures/query-engine.ts`**: Consolidated `buildListDisplayConfiguration` into a re-export of `buildGridDisplayConfiguration` since they had identical implementations.

### Not addressed

- The `createJoinLocalFilterCompiler` in `relationship-join-ctes.ts` duplicates much of `createScalarExpressionCompiler` in `expression-compiler.ts`. Extracting this would require a significant refactor of the core expression compiler with no dedicated unit tests, so it was left as a future improvement.
