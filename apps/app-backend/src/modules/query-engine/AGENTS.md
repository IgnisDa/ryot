# Query Engine Agent Notes

## Module Purpose

Accepts a `QueryDocument` (a JSON-serializable, source-based query language), validates it, enforces authenticated visibility for every source and traversal, compiles it to SQL, and marshals the returned rows into typed rows / aggregate / time-series responses. Execution happens entirely in Postgres — there is no application-side row evaluation.

## Abstraction Boundaries

- **language.ts**: Effect Schema source of truth for the entire DSL and response shapes. Types are derived from schemas; do not duplicate shapes as hand-written interfaces.
- **validator/**: Pure semantic validation (`document.ts`, `core.ts`, `output.ts`, `shared.ts`), DB-aware reference validation (`references.ts`), and type-compatibility validation (`type-check.ts`, which also enforces ISO date literals). Pure validation must not import executor runtime code except `schema-loaders` and `time-series-buckets`.
- **executor/compile/**: Pure SQL compilation — no DB, no Effect.
  - `expr.ts`: the total `Expr` → SQL compiler (`compileBool` / `compileScalar` / `compileValue`), including correlated `exists` / `aggregate` / `first` subqueries. Every node compiles; nothing falls back to app code.
  - `scope.ts`: `CompileScope` — maps doc aliases to SQL aliases, walks the parent chain for correlation, and allocates unique aliases for nested subqueries.
  - `fragments.ts`: low-level SQL fragment helpers (system/schema columns, jsonb property extraction, visibility, jsonb→kind, time bucketing).
  - `select-list.ts`: output-field, measure, and group-key column builders.
  - `includes.ts`: nested `LATERAL` + `jsonb_agg` builder for include sub-trees.
- **executor/root-source.ts**: Visible-schema loading and the root FROM/WHERE builders (per-user visibility enforced). Every root source path goes through it.
- **executor/{aggregate,rows,time-series}.ts**: Per-output executors — build one SQL query, run it, and marshal the result.
- **executor/reconstruct.ts** and **executor/reshape.ts**: Map raw DB values into the `{ kind, value }` DTO (`reconstruct.ts`) and include jsonb arrays into `IncludedRowsValue` trees (`reshape.ts`). Must not construct SQL.
- **executor/schema-loaders.ts**: Visible schema loading with user isolation. Shared by `references.ts` and the executor — every source path must go through it.
- **time-series-buckets.ts**: Bucket alignment used by the validator to bound the aligned bucket count (≤1000) before execution. Pure, no DB. The executor builds the bucket grid in SQL (`generate_series`), not from this module.

## Conventions

- Keep `routes.ts` thin and keep request/response contracts in `contract.ts` and `language.ts`.
- Validation-limit constants (page size, include depth/limit, aggregate limit, bucket count) live in `validator/shared.ts`. Execution has no in-memory row caps; a runaway query is bounded by a transaction-local `statement_timeout` (`QUERY_ENGINE_STATEMENT_TIMEOUT_MS` in `service.ts`).
- When changing the query language, update `README.md` in this directory and the examples in `tests/src/fixtures/query-engine.ts` and `tests/src/tests/query-engine.test.ts`.
