# Query Engine Agent Notes

> Inherits from `apps/app-backend/AGENTS.md`. Rules below are additive.

## Module Purpose

Accepts a declarative query (scope, fields, expressions, filters, sorts, pagination) and returns typed, display-ready results for grids, lists, and tables.

## Abstraction Boundaries

- **query-builder.ts**: SQL shaping (CTEs, joins, filtering, sorting, pagination). Must not format display values.
- **display-builder.ts**: Field-value resolution (expressions → JSONB `{ kind, value }`). Must not construct SQL.
- **expression-compiler.ts**: Shared core translating ViewExpression AST → Drizzle SQL. Both builders depend on it.
- **filter-builder.ts** / **sort-builder.ts**: Delegate to the expression compiler.
- **preparer.ts**: Orchestrates the pipeline — loads schemas, validates references, calls `executePreparedQuery`.
- Reference validation and parsing live outside this module (`~/lib/views/validator.ts`, `~/lib/views/reference.ts`).

## Conventions

- Keep `routes.ts` thin and keep request/response contracts in `schemas.ts`.
- When changing the query language, update `README.md` in this directory and the examples in `tests/src/fixtures/query-engine.ts`, `tests/src/test-support/query-engine-suite.ts`, and `tests/src/tests/query-engine.test.ts`.
