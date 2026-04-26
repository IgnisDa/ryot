# Validation and Type Inference

**Parent Plan:** [Entity Schema Fields Expression](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add validation and type inference branches for `entity-schema` references so the query engine accepts them in sort expressions, filter predicates, display configurations, and computed fields — and rejects invalid column names or nested paths.

### Scope

- Add `entity-schema` handler in `validateRuntimeReferenceAgainstSchemas`. Validate that `path[0]` exists in `entitySchemaBuiltinColumns`. Reject empty paths. Reject nested paths (path length > 1 is not supported since `propertiesSchema` is excluded).
- Add `entity-schema` handler in `inferViewExpressionType` (the expression type inference function). For scalar columns, look up the property type via `getEntitySchemaColumnPropertyType` and return the correct `ViewExpressionTypeInfo`. This handler must come **before** the existing event reference fallthrough.
- Ensure the validator correctly checks both `sortFilterBuiltins` and `displayBuiltins` for entity schema columns when validating in sort/display contexts respectively.
- Ensure entity schema column types pass `assertSortableExpression`, `assertComparableExpression`, and `assertContainsCompatibleExpression` checks appropriately (booleans, strings, datetimes are all comparable).

### Files

- `apps/app-backend/src/lib/views/validator.ts` — `validateRuntimeReferenceAgainstSchemas` new branch
- `apps/app-backend/src/lib/views/expression-analysis.ts` — `inferViewExpressionType` new branch

## Acceptance criteria

- [x] `{ type: "entity-schema", path: ["slug"] }` passes validation
- [x] `{ type: "entity-schema", path: ["nonexistent"] }` fails validation with a descriptive error
- [x] `{ type: "entity-schema", path: [] }` fails validation with an empty-path error
- [x] `{ type: "entity-schema", path: ["slug", "nested"] }` fails validation (no nested traversal)
- [x] `inferViewExpressionType` returns `{ kind: "property", propertyType: "date" }` for slug
- [x] `inferViewExpressionType` returns `{ kind: "property", propertyType: "boolean" }` for isBuiltin
- [x] `inferViewExpressionType` returns `{ kind: "property", propertyType: "date" }` for createdAt
- [x] Entity schema columns that are filterable pass `assertSortableExpression` and `assertComparableExpression`
- [x] Entity schema columns that are not filterable (icon, accentColor) are accepted for display but rejected for sort/filter

## User stories addressed

None directly — enables all user stories that use entity schema fields in expressions.

## Implementation notes

- `validateRuntimeReferenceAgainstSchemas` validates entity-schema columns against `validBuiltins` (context-specific: `sortFilterBuiltins` or `displayBuiltins`) and `entitySchemaBuiltinColumns` (existence check).
- `inferViewExpressionType` resolves entity-schema column types via `getEntitySchemaColumnPropertyDefinition`, which returns the full `AppPropertyDefinition` from `entitySchemaRuntimeColumns`.
- `getEntitySchemaColumnPropertyDefinition` was added to `reference.ts` to provide a type-safe definition (replaces passing raw `{ label, type }` objects).
- `validateViewPredicateAgainstSchemas` gained an optional `validBuiltins` parameter. Filter expressions are validated through a new `validateFilterExpression` wrapper that checks entity-schema reference columns against the provided builtins set. Both call sites (conditional expressions and `validateQueryEngineReferences`) pass appropriate builtins sets.
- `normalizeExpressionPropertyType("datetime")` produces `"date"` for consistency with entity column handling. Acceptance criteria reflect this.
