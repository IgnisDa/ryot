## Problem Statement

The query engine currently returns `entitySchemaSlug` and `entitySchemaId` as hardcoded top-level fields on every `QueryEngineItem`. Users cannot reference these — or any other entity schema column — through the expression/display configuration system. To show the entity type in a table column or card, the frontend must read special-case top-level attributes rather than using the uniform `ViewExpression` → fields pipeline.

The problem extends beyond `entitySchemaSlug`. The entity schema table has useful metadata columns (slug, name, icon, accent color, timestamps, whether it is a built-in schema) that should be referenceable as displayable, filterable, and sortable fields — just like entity built-in columns and custom properties already are.

## Solution

Remove `entitySchemaSlug` and `entitySchemaId` from the `QueryEngineItem` top-level response. Expose all scalar entity schema columns as referenceable fields through a new `entity-schema` RuntimeRef type. Users add them to saved view display configurations, sort expressions, filter predicates, and computed field expressions the same way they add entity columns or custom properties.

A single JSONB column in the query engine CTE stores the full entity schema row, keeping the CTE projection compact and making all schema columns accessible through a uniform expression compiler path.

## User Stories

1. As a saved view user, I want to display the entity schema name as a table column, so that multi-schema views (e.g., "All Books and Movies") show which type each row belongs to.
2. As a saved view user, I want to filter entities by their entity schema slug, so that I can narrow a multi-schema view to a single schema type without switching views.
3. As a saved view user, I want to sort entities by their entity schema name, so that results group by entity type in lists and tables.
4. As a saved view user, I want to display the entity schema icon as an image property on entity cards, so that cards show the schema icon alongside the entity image.
5. As a saved view user, I want to display the entity schema accent color, so that cards or badges can be styled per schema type.
6. As a saved view user, I want to filter entities to only those belonging to built-in entity schemas, so that I can distinguish system schemas from user-defined ones.
7. As a saved view user, I want to reference entity schema columns in computed fields, so that I can build concatenated labels like "Schema: Book" from schema name and entity data.
8. As a saved view user, I want to use entity schema `createdAt` and `updatedAt` in sort expressions, so that I can order views by when the schemas were created or updated.
9. As a frontend developer, I want entity schema fields to be available in the expression field picker alongside entity built-in columns and custom properties, so that users discover them naturally.
10. As an API consumer, I want the query engine response to treat entity schema fields uniformly through the fields array, so that my code handles all displayable values through the same resolved-display-value pipeline.

## Implementation Decisions

### New RuntimeRef type: `entity-schema`

A new variant is added to the `RuntimeRef` discriminated union and its corresponding Zod schema. The shape is `{ type: "entity-schema", path: string[] }` where `path[0]` is one of nine camelCase column names. No `slug` discriminator is needed because each entity has exactly one associated entity schema — the reference is always to the schema of the current row.

### Nine exposed scalar columns

The following entity schema columns are referenceable: `id`, `slug`, `name`, `icon`, `accentColor`, `isBuiltin`, `userId`, `createdAt`, `updatedAt`. The `propertiesSchema` JSONB column is deliberately excluded — it contains schema metadata (property definitions), not per-entity data values.

Column names use camelCase in the expression layer, matching the existing convention for entity built-in columns (`createdAt`, `updatedAt`, `externalId`, `sandboxScriptId`).

### Single JSONB column in the query engine CTE

Instead of adding nine individual SQL aliases to the base entities CTE, the entire entity schema row is stored as a single `entity_schema_data` JSONB column built with `jsonb_build_object`. This:

- Replaces the existing `entity_schema_slug` and `entity_schema_id` discrete columns
- Propogates automatically through downstream CTEs via `base_entities.*`
- Keeps the CTE projection minimal
- Allows the expression compiler to handle all schema columns through a single code path with column-name dispatch

The internal multi-schema CASE WHEN logic (which previously compared `alias.entity_schema_slug = 'book'`) transitions to `alias.entity_schema_data ->> 'slug' = 'book'`.

### Separate runtime column configs

Entity schema columns get their own `entitySchemaRuntimeColumns` record (separate from `entityRuntimeColumns`), their own `entitySchemaBuiltinColumns` set in the shared ts-utils package, and their own `getEntitySchemaColumnPropertyType` helper. However, the column names feed into the existing `sortFilterBuiltins` and `displayBuiltins` sets so validation logic treats them uniformly.

### Top-level field removal

`entitySchemaId` and `entitySchemaSlug` are removed from `queryEngineBaseItemSchema` and the resulting `QueryEngineItem` type. The OpenAPI types regenerate accordingly. Since this is a greenfield project with no existing clients, no backwards compatibility is preserved.

### Column display/filter/sort matrix

| Column | Display | Filter | Sort | Type |
|--------|---------|--------|------|------|
| `id` | yes | yes | yes | string |
| `slug` | yes | yes | yes | string |
| `name` | yes | yes | yes | string |
| `icon` | yes | no | no | string |
| `accentColor` | yes | no | no | string |
| `isBuiltin` | yes | yes | yes | boolean |
| `userId` | yes | yes | yes | string |
| `createdAt` | yes | yes | yes | datetime |
| `updatedAt` | yes | yes | yes | datetime |

### Expression compiler integration

A new `buildEntitySchemaExpression` function in the expression compiler handles `entity-schema` references. For the simple case (`path` length 1), it produces `alias.entity_schema_data ->> 'column'` with type casting where needed (`::boolean` for `isBuiltin`, `::timestamptz` for datetime columns). No multi-schema CASE WHEN wrapping is applied because every entity row already carries the correct schema data.

### Validation and type inference

The expression validator and type inference engine both gain branches for the `entity-schema` reference type. Validation checks that `path[0]` exists in `entitySchemaBuiltinColumns`. Type inference looks up the column in `entitySchemaRuntimeColumns` to determine the property type for filter/sort compatibility checks.

### Module boundaries

- `@ryot/ts-utils` — owns the `entitySchemaBuiltinColumns` set, the `RuntimeRef` type, and the `createEntitySchemaExpression` factory
- `lib/views/reference` — owns `entitySchemaRuntimeColumns` config, type helpers, and builtin set derivation
- `lib/views/expression` — owns the `runtimeReferenceSchema` Zod schema
- `lib/views/validator` — owns reference-level validation
- `lib/views/expression-analysis` — owns expression type inference
- `query-engine/expression-compiler` — owns SQL generation for the new reference type
- `query-engine/query-builder` — owns the CTE structure and `QueryRow` type
- `query-engine/schemas` — owns the `QueryEngineItem` response shape

## Testing Decisions

### What makes a good test

Tests should exercise the new component's externally observable behavior, not internal implementation details. For expression compilation, this means testing that a given `ViewExpression` produces expected SQL fragments. For validation, this means testing that invalid column names are rejected. For type inference, this means testing that each column returns the correct `PropertyType`. Avoid Zod smoke tests and TypeScript-redundant assertions.

### Modules to test

- **expression-compiler** — SQL output for each entity schema column, type casting correctness, absence of multi-schema CASE WHEN wrapping
- **validator** — acceptance of valid entity-schema columns, rejection of invalid column names, rejection of nested paths (no `propertiesSchema` traversal)
- **expression-analysis** — type inference for each column returns correct `PropertyType`
- **query-builder** — JSONB column is present in CTE projection, old discrete columns are absent

### Prior art

- `lib/views/expression-analysis.test.ts` — existing tests for entity/property/event expression type inference
- `query-engine/expression-compiler.test.ts` — existing tests using `createScalarExpressionCompiler` to verify SQL output
- `lib/views/reference.test.ts` — existing tests for column property type resolution

## Out of Scope

- Traversing into `propertiesSchema` JSONB — this is schema metadata, not per-entity data
- Adding entity schema relationship columns (the entity_schema table has no relationships in the current schema)
- GraphQL exposure of entity schema fields (the query engine is REST-only)
- Backwards compatibility shims for `entitySchemaSlug` and `entitySchemaId` on the `QueryEngineItem` response
- Auto-generating entity schema columns in default saved view display configurations

## Further Notes

The existing `entity_schema_slug` column is used in the expression compiler for multi-schema CASE WHEN logic. This internal dependency is fully migrated to `entity_schema_data ->> 'slug'` as part of this change. The JSONB extraction overhead is negligible at personal tracking data volumes.

When implementing, follow the existing patterns in the expression compiler closely: `buildEntityExpression` (for entity references) and `buildEventExpression` (for event references) serve as the reference architecture for `buildEntitySchemaExpression`.

---

## Tasks

**Overall Progress:** 5 of 5 tasks completed

**Current Task:** None — all tasks complete.

### Task List

| #   | Task                                                                                       | Type | Status |
| --- | ------------------------------------------------------------------------------------------ | ---- | ------ |
| 01  | [Shared Types and RuntimeRef Definition](./01-shared-types-runtimeref-definition.md)       | AFK  | done  |
| 02  | [Validation and Type Inference](./02-validation-type-inference.md)                         | AFK  | done  |
| 03  | [Expression Compiler, Query Builder, and Response Shape](./03-expression-compiler-query-builder.md) | AFK  | done   |
| 04  | [Frontend: Read Entity Schema Info from Fields](./04-frontend-entity-schema-fields.md)     | AFK  | done   |
| 05  | [Codebase Cleanup](./05-codebase-cleanup.md)                                               | AFK  | done   |
