# E2E Test Infrastructure and Test Updates

**Parent Plan:** [Query Engine Reference Syntax Refactor](./README.md)

**Type:** AFK

**Status:** done

## What to build

Migrate all E2E test infrastructure, seed-script data, and test assertions to use
the new reference path syntax. This slice touches four areas:

1. **`tests/src/fixtures/view-language.ts`** — The shared fixture module that
   converts string shorthand to `RuntimeRef` JSON:
   - `entityField(slug, property)`: built-in fields are emitted without `@`
     (e.g. `entity.book.name`); schema properties are emitted with the
     `properties.` keyword (e.g. `entity.book.properties.year`).
   - `parseReference(ref)`: updated to handle 3-segment entity/event column
     paths (no `@`) and 4+-segment `properties.` paths. Old `@`-prefixed paths
     must throw.
   - `schemaPropertyExpression(slug, property)`: `property` field becomes
     `[property]` (single-element array) to match the updated `RuntimeRef` type.

2. **`tests/src/test-support/query-engine-suite.ts`** — Replace all remaining
   `@`-prefixed string literals such as `"event.review.@createdAt"` with
   `"event.review.createdAt"`.

3. **`tests/src/seed-script.ts`** — Replace every occurrence of `"@createdAt"`,
   `"@name"`, `"@updatedAt"`, and event-qualified forms like
   `"event.tasting.@createdAt"` and `"event.purchase.@createdAt"` with their
   unprefixed equivalents.

4. **`tests/src/tests/query-engine.test.ts` and `tests/src/tests/saved-views.test.ts`** —
   Update test names that mention `@externalId` / `@sandboxScriptId`, and update
   error-message assertions such as `"Unsupported entity column 'entity.book.@nam'"`.

After this slice all E2E tests that were passing before continue to pass with the
new syntax.

## Acceptance criteria

- [x] `entityField("book", "name")` emits `"entity.book.name"` (not
  `"entity.book.@name"`).
- [x] `entityField("book", "year")` emits `"entity.book.properties.year"` (not
  `"entity.book.year"`).
- [x] `parseReference("entity.book.sandboxScriptId")` returns
  `{ type: "entity-column", slug: "book", column: "sandboxScriptId" }`.
- [x] `parseReference("entity.book.properties.author")` returns
  `{ type: "schema-property", slug: "book", property: ["author"] }`.
- [x] `parseReference("event.review.createdAt")` returns
  `{ type: "event-join-column", joinKey: "review", column: "createdAt" }`.
- [x] `parseReference("event.review.properties.rating")` returns
  `{ type: "event-join-property", joinKey: "review", property: ["rating"] }`.
- [x] `parseReference("entity.book.@sandboxScriptId")` throws.
- [x] No string literal in the `tests/` directory still contains `".@"` in a
  reference context.
- [x] The `saved-views.test.ts` error-message assertion matches the updated format
  (no `@` in the error string).
- [x] All previously passing E2E tests continue to pass.

## Blocked by

- [Task 02](./02-openapi-spec-regeneration.md)

## User stories addressed

- User story 11
