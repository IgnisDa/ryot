# Core Type, Parser, and SQL Changes

**Parent Plan:** [Query Engine Reference Syntax Refactor](./README.md)

**Type:** AFK

**Status:** done

## What to build

This is the foundational slice. It changes every layer of the backend that touches
`RuntimeRef`, `parseFieldPath`, or property-to-SQL compilation:

1. **`RuntimeRef` schema** — Change `property: string` to `property: string[]`
   (min length 1) for both `schema-property` and `event-join-property` variants.
   Update the TypeScript union type to match.

2. **`parseFieldPath` grammar** — Rewrite the parser to implement the new grammar:
   - `entity.{slug}.{column}` (3 segments) → `entity-column`
   - `entity.{slug}.properties.{p1}[.{p2}...]` (4+ segments) → `schema-property`
     with `property: [p1, p2, ...]`
   - `event.{joinKey}.{column}` (3 segments) → `event-join-column`
   - `event.{joinKey}.properties.{p1}[.{p2}...]` (4+ segments) → `event-join-property`
     with `property: [p1, p2, ...]`
   - `computed.{key}` (2 segments) → `computed-field` (unchanged)
   - All other shapes throw `Invalid field path: {input}`
   - `resolveRuntimeReference` is updated to match, with validation that the path
     starts with a known namespace prefix.

3. **Property-path traversal helpers** — Update `getPropertyType` and
   `getEventJoinPropertyDefinition` (and `getEventJoinPropertyType`) in the
   reference module to accept `string[]` paths and traverse nested
   `AppPropertyDefinition.properties` for `object`-typed nodes. Traversal returns
   `null` if any intermediate segment is absent or non-object.

4. **Expression type analyzer** — Update `inferViewExpressionType` in
   expression-analysis to use the new traversal helpers for `schema-property`
   and `event-join-property` references. Error messages are updated to join the
   path array with `.` and to remove `@` from entity-column / event-join-column
   messages.

5. **SQL compiler** — Add a `buildPropertyPathExpression` helper that chains
   `-> p1 -> p2 ->> pN` (or `-> pN` for JSON mode). Update
   `buildSchemaPropertyExpression` and `buildEventJoinPropertyExpression` to use
   it for `property: string[]`. Remove `@` from the error message.

6. **Validator** — Update error messages in `validateRuntimeReferenceAgainstSchemas`
   to join property paths with `.` and remove `@` from column messages.

7. **Backend test fixtures** — Update `entityExpression` and `eventExpression` in
   the backend test-fixture helper to remove the `@`-prefix branch and to produce
   `property: [field]` arrays. Update any backend unit tests (`reference.test.ts`,
   `expression-compiler.test.ts`, `filter-builder.test.ts`) to use the new path
   strings and expected `RuntimeRef` shapes.

After this slice `bun run typecheck`, `bun run test`, and `bun run lint` all pass
inside `apps/app-backend`.

## Acceptance criteria

- [x] `RuntimeRef` schema and TypeScript type use `property: string[]` for
  `schema-property` and `event-join-property`.
- [x] `parseFieldPath("entity.book.sandboxScriptId")` returns
  `{ type: "entity-column", slug: "book", column: "sandboxScriptId" }`.
- [x] `parseFieldPath("entity.book.properties.author")` returns
  `{ type: "schema-property", slug: "book", property: ["author"] }`.
- [x] `parseFieldPath("entity.book.properties.metadata.source")` returns
  `{ type: "schema-property", slug: "book", property: ["metadata", "source"] }`.
- [x] `parseFieldPath("event.review.createdAt")` returns
  `{ type: "event-join-column", joinKey: "review", column: "createdAt" }`.
- [x] `parseFieldPath("event.review.properties.rating")` returns
  `{ type: "event-join-property", joinKey: "review", property: ["rating"] }`.
- [x] `parseFieldPath("entity.book.@sandboxScriptId")` throws `Invalid field path`.
- [x] `parseFieldPath("entity.book.author")` throws `Invalid field path`.
- [x] `parseFieldPath("event.review.@createdAt")` throws `Invalid field path`.
- [x] `parseFieldPath("event.review.rating")` throws `Invalid field path`.
- [x] SQL generated for `property: ["author"]` is identical to what was previously
  generated for `property: "author"`.
- [x] SQL generated for `property: ["metadata", "source"]` chains
  `-> 'metadata' ->> 'source'` (text) or `-> 'metadata' -> 'source'` (JSON).
- [x] `getPropertyType(schema, ["metadata", "source"])` returns `"string"` for the
  smartphone fixture schema.
- [x] `getPropertyType(schema, ["metadata", "nonexistent"])` returns `null`.
- [x] All error messages from the validator and analyzer use the new path syntax
  (no `@`, property paths joined with `.`).
- [x] `bun run typecheck`, `bun run test`, and `bun run lint` pass in
  `apps/app-backend`.

## Blocked by

None — can start immediately.

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 4
- User story 8
- User story 9
