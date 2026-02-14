# Shared Types and RuntimeRef Definition

**Parent Plan:** [Entity Schema Fields Expression](./README.md)

**Type:** AFK

**Status:** todo

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

- [ ] `entitySchemaBuiltinColumns` contains exactly 9 camelCase column names, no `propertiesSchema`
- [ ] `createEntitySchemaExpression("slug")` produces `{ type: "reference", reference: { type: "entity-schema", path: ["slug"] } }`
- [ ] `runtimeReferenceSchema` accepts `{ type: "entity-schema", path: ["slug"] }` and rejects `{ type: "entity-schema", path: [] }`
- [ ] `getEntitySchemaColumnPropertyType("isBuiltin")` returns `"boolean"`
- [ ] `getEntitySchemaColumnPropertyType("createdAt")` returns `"datetime"`
- [ ] `getEntitySchemaColumnPropertyType("icon")` returns `"string"`
- [ ] `sortFilterBuiltins` includes filterable entity schema column names (`id`, `slug`, `name`, `isBuiltin`, `userId`, `createdAt`, `updatedAt`)
- [ ] `displayBuiltins` includes all 9 entity schema column names
- [ ] TypeScript compilation succeeds with the new types

## User stories addressed

None directly — foundation for all user stories.
