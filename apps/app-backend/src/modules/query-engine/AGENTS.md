# Query Engine Agent Notes

> Inherits from `apps/app-backend/AGENTS.md`. Rules below are additive.

## Module Purpose

The query engine is a query-and-field-resolution module that powers dynamic data retrieval. It accepts a declarative query (entity schema slugs, field selections, expressions, filters, sorts, pagination) and returns typed, display-ready results. The UI uses it to render grids, lists, and tables without hardcoding per-schema field resolution.

## Abstraction Boundaries

- **query-builder.ts** owns SQL shaping: CTEs, joins, filtering, sorting, pagination, and row extraction. It must not format display values.
- **display-builder.ts** owns field-value resolution: compiling expressions to JSONB, inferring types, and wrapping values in `{ kind, value }` objects. It must not construct SQL queries.
- **expression-compiler.ts** is the shared core that translates the ViewExpression AST into Drizzle SQL expressions. Both builders depend on it.
- **filter-builder.ts** and **sort-builder.ts** delegate to the expression compiler for their SQL generation.
- **preparer.ts** orchestrates the pipeline: loads schemas from the DB, validates references, and calls `executePreparedQuery`.
- Reference validation (`~/lib/views/validator.ts`) and reference parsing (`~/lib/views/reference.ts`) live outside this module — do not duplicate that logic here.

## Conventions

- Keep `routes.ts` thin and keep request/response contracts in `schemas.ts`.
- When changing the query language, update `README.md` in this directory and the examples in `tests/src/fixtures/query-engine.ts`, `tests/src/test-support/query-engine-suite.ts`, and `tests/src/tests/query-engine.test.ts`.
