# Reference Type Rename

**Parent Plan:** [Query Engine Modes](./README.md)

**Type:** AFK

**Status:** done

## What to build

Rename the existing `event` reference type to `event-join` across the entire codebase, and introduce structural definitions for two new reference types (`event` and `event-schema`) that will be used by subsequent event-first modes.

This is a prerequisite rename that ensures clear naming before new modes are built. After this task, existing entity mode continues to work unchanged — all tests pass with the new `event-join` naming.

### Reference rename: `event` → `event-join`

The existing reference `{ type: "event", joinKey: string, path: string[] }` becomes `{ type: "event-join", joinKey: string, path: string[] }`. This affects:

- The `RuntimeRef` type definition in `@ryot/ts-utils`
- The Zod runtime reference schema in `~/lib/views/expression.ts`
- The expression compiler handler in `~/modules/query-engine/expression-compiler.ts`
- The reference resolution helpers in `~/lib/views/reference.ts`
- The validator in `~/lib/views/validator.ts`
- All test files and fixtures referencing the old type
- The media service code in `~/modules/media/service.ts`

### New reference type definitions (structural only)

Add two new variants to the `RuntimeRef` discriminated union:

1. `{ type: "event", eventSchemaSlug?: string, path: string[] }` — for primary event row access in event-first modes. `eventSchemaSlug` is required when `path[0]` is `"properties"`. Built-in columns: `id`, `createdAt`, `updatedAt`.

2. `{ type: "event-schema", path: string[] }` — for event schema metadata. Available columns: `id`, `slug`, `name`, `isBuiltin`, `createdAt`, `updatedAt`. All filterable, sortable, displayable.

In this task, only the Zod schemas and TypeScript types are defined. The expression compiler handlers, validator rules, and query builder support for these new types are built in subsequent tasks. The validator should reject these new reference types for now (since no mode supports them yet).

## Acceptance criteria

- [x] `RuntimeRef` type in `@ryot/ts-utils` has `event-join` (with joinKey), `event` (with optional eventSchemaSlug), and `event-schema` variants
- [x] Zod schemas validate all three reference types correctly
- [x] All existing code that used `{ type: "event", joinKey: ... }` now uses `{ type: "event-join", joinKey: ... }`
- [x] Expression compiler handles `event-join` references (same logic as before, just new type discriminant)
- [x] Validator rejects `event` and `event-schema` references in entity mode with a clear error message
- [x] All existing tests pass with the renamed reference type
- [x] Media service code uses the new `event-join` naming
- [x] `bun run typecheck`, `bun run test`, and `bun run lint` pass

## Notes

- Kept the external field-path namespace as `event.*`; only the internal runtime discriminant changed to `event-join`.
- Added structural `event` and `event-schema` reference variants in the shared type and Zod schema, but they remain intentionally rejected by the current entity-mode validator and expression analysis until later mode tasks land.
- Verified with `bun turbo --filter='@ryot/ts-utils' --filter='@ryot/app-backend' --filter='@ryot/tests' lint -- --write`, `bun turbo --filter='@ryot/ts-utils' --filter='@ryot/app-backend' --filter='@ryot/tests' typecheck`, and `bun turbo --filter='@ryot/app-backend' --filter='@ryot/tests' test`.

## User stories addressed

- User story 19
