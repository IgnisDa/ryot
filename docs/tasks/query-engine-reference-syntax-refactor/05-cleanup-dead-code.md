# Cleanup Dead Code and Useless Tests

**Parent Plan:** [Query Engine Reference Syntax Refactor](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Remove code and tests that became obsolete after the syntax refactor:

1. **`@`-prefix handling in backend test-fixture helpers** — After Task 01 the
   `@`-prefix branches in `entityExpression` and `eventExpression`
   (`apps/app-backend/src/lib/test-fixtures/view-language.ts`) are dead. Remove
   any remaining guards. If the helpers now only produce one ref type each
   (schema-property / event-join-property), consider whether they should be
   renamed or replaced by the already-existing explicit helpers
   (`entityColumnExpression`, `schemaPropertyExpression`, etc.) to avoid
   future confusion.

2. **Move `parseFieldPath` and `resolveRuntimeReference` out of production code** —
   These functions have no production call sites. The API accepts `RuntimeRef`
   JSON objects directly; the string path format (`entity.book.properties.author`)
   is purely a test-infrastructure and documentation convention. Both functions
   should be moved out of `apps/app-backend/src/lib/views/reference.ts` and into
   the test-fixture layer (`apps/app-backend/src/lib/test-fixtures/` or a
   dedicated test-support module). Any unit tests that cover `parseFieldPath`
   should move with it. After the move, `reference.ts` must not export either
   function, and no production source file may import them.

3. **Trivially-true or now-redundant tests** — Per the backend testing guidelines,
   remove tests that:
   - Only verify that a Zod schema accepts a valid value without checking
     any app-specific constraint.
   - Duplicate assertions that are already covered by tests updated in Tasks 01
     or 04, with no additional behavioral coverage.
   - Contain `as string` or `as unknown as Y` casts used to silence a TypeScript
     error that would otherwise make the assertion always-true or always-false.

4. **`tests/src/fixtures/view-language.ts` — old `@` guards** — After Task 04,
   the `@`-prefix path through `entityField` and `parseReference` is deleted. Remove
   any remaining dead branches or helper overloads that only existed to support
   the old syntax.

After this slice `bun run typecheck`, `bun run test`, and `bun run lint` pass in
both `apps/app-backend` and `apps/app-frontend`, and the E2E test suite is
unchanged.

## Acceptance criteria

- [ ] No `startsWith("@")` guard remains in any test-fixture or view-language
  helper that was part of the pre-refactor `@`-prefix detection logic.
- [ ] `parseFieldPath` and `resolveRuntimeReference` are not exported from any
  file under `apps/app-backend/src/lib/views/` or any other production source
  path.
- [ ] `parseFieldPath` and its unit tests live in the test-fixture or
  test-support layer, not in production source.
- [ ] No production source file imports `parseFieldPath` or
  `resolveRuntimeReference`.
- [ ] No test file contains a `safeParse(validInput).success === true` assertion
  that only proves Zod parsing works.
- [ ] No test file contains a cast (`as string`, `as unknown as T`) that suppresses
  a TypeScript error to make a comparison meaningful.
- [ ] `bun run typecheck`, `bun run test`, and `bun run lint` pass in
  `apps/app-backend` and `apps/app-frontend`.
- [ ] E2E test results are unchanged.

## Blocked by

- [Task 01](./01-core-type-parser-and-sql.md)
- [Task 03](./03-frontend-resolve-property-type.md)
- [Task 04](./04-e2e-test-infrastructure.md)

## User stories addressed

- User story 8 (old paths fully rejected, no dead code keeps them alive)
