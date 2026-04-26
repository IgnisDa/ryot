# Validation and Type Inference

**Parent Plan:** [Entity Schema Fields Expression](./README.md)

**Type:** AFK

**Status:** todo

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

- [ ] `{ type: "entity-schema", path: ["slug"] }` passes validation
- [ ] `{ type: "entity-schema", path: ["nonexistent"] }` fails validation with a descriptive error
- [ ] `{ type: "entity-schema", path: [] }` fails validation with an empty-path error
- [ ] `{ type: "entity-schema", path: ["slug", "nested"] }` fails validation (no nested traversal)
- [ ] `inferViewExpressionType` returns `{ kind: "property", propertyType: "string" }` for slug
- [ ] `inferViewExpressionType` returns `{ kind: "property", propertyType: "boolean" }` for isBuiltin
- [ ] `inferViewExpressionType` returns `{ kind: "property", propertyType: "datetime" }` for createdAt
- [ ] Entity schema columns that are filterable pass `assertSortableExpression` and `assertComparableExpression`
- [ ] Entity schema columns that are not filterable (icon, accentColor) are accepted for display but rejected for sort/filter

## User stories addressed

None directly — enables all user stories that use entity schema fields in expressions.
