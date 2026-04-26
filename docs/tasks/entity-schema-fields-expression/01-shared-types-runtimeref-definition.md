# Shared Types and RuntimeRef Definition

**Parent Plan:** [Entity Schema Fields Expression](./README.md)

**Type:** AFK

**Status:** done

## Completion notes

- Added stub throw branches in `expression-compiler.ts`, `expression-analysis.ts`, and `validator.ts` for the new `entity-schema` variant to preserve exhaustiveness narrowing. Full logic belongs to Tasks 02–03.
- Tests added for `getEntitySchemaColumnPropertyType` covering all 9 columns, unknown columns, and invalid inputs.
- `runtimeReferenceSchema` and `createEntitySchemaExpression` correctness is verified through the compile-time `RuntimeRef` ↔ schema bidirectional `extends` assertion.

## What to build

Define the new `entity-schema` RuntimeRef variant and all supporting type/config infrastructure. This forms the foundation that validation, compilation, and query execution will build on.

### Scope

- Add `entitySchemaBuiltinColumns` read-only set to the shared `@ryot/ts-utils` package containing nine camelCase column names: `id`, `slug`, `name`, `icon`, `accentColor`, `isBuiltin`, `userId`, `createdAt`, `updatedAt`.
- Add `{ type: "entity-schema"; path: string[] }` to the `RuntimeRef` discriminated union type in ts-utils.
- Add `createEntitySchemaExpression(column: string)` factory function that returns a `RuntimeReferenceExpression` with the `entity-schema` reference type.
- Add `entity-schema` variant to `runtimeReferenceSchema` Zod schema in the expression module, matching the new RuntimeRef shape exactly.
- Add `entitySchemaRuntimeColumns` record with display/filter configs and property types for each column (see matrix in PRD).
- Add `getEntitySchemaColumnPropertyType(column: string)` helper that returns `PropertyType | null`.
- Feed entity schema column names (filterable ones) into the existing `sortFilterBuiltins` set.
- Feed entity schema column names (displayable ones) into the existing `displayBuiltins` set.

### Files

- `libs/ts-utils/src/view-language.ts` — `entitySchemaBuiltinColumns` set, `RuntimeRef` type extension, factory function
- `apps/app-backend/src/lib/views/expression.ts` — `runtimeReferenceSchema` Zod schema extension
- `apps/app-backend/src/lib/views/reference.ts` — `entitySchemaRuntimeColumns` record, type helper, builtin set updates

## Acceptance criteria

- [x] `entitySchemaBuiltinColumns` contains exactly 9 camelCase column names, no `propertiesSchema`
- [x] `createEntitySchemaExpression("slug")` produces `{ type: "reference", reference: { type: "entity-schema", path: ["slug"] } }`
- [x] `runtimeReferenceSchema` accepts `{ type: "entity-schema", path: ["slug"] }` and rejects `{ type: "entity-schema", path: [] }`
- [x] `getEntitySchemaColumnPropertyType("isBuiltin")` returns `"boolean"`
- [x] `getEntitySchemaColumnPropertyType("createdAt")` returns `"datetime"`
- [x] `getEntitySchemaColumnPropertyType("icon")` returns `"string"`
- [x] `sortFilterBuiltins` includes filterable entity schema column names (`id`, `slug`, `name`, `isBuiltin`, `userId`, `createdAt`, `updatedAt`)
- [x] `displayBuiltins` includes all 9 entity schema column names
- [x] TypeScript compilation succeeds with the new types

## User stories addressed

None directly — foundation for all user stories.
