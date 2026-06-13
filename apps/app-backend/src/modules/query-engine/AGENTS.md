# Query Engine Agent Notes

## Module Purpose

Accepts a v2 `QueryDocument` (a JSON-serializable, source-based query language), validates it, enforces authenticated visibility for every source and traversal, executes it, and serializes rows, aggregate, or time-series responses with typed field values.

## Abstraction Boundaries

- **language.ts**: Effect Schema source of truth for the entire DSL and response shapes. Types are derived from schemas; do not duplicate shapes as hand-written interfaces.
- **validator/**: Pure semantic validation (`index.ts`, `core.ts`, `output.ts`, `shared.ts`) and DB-aware reference validation (`references.ts`). Pure validation must not import executor runtime code except `schema-loaders` and `time-series-buckets`.
- **executor/sql.ts**: The only place that maps field selectors to Drizzle `sql` fragments.
- **executor/field-values.ts**: `FieldSelector` → `FieldValue` resolution. Must not construct SQL.
- **executor/expr.ts**: Expression evaluation over row contexts. Pure, no SQL.
- **executor/serialize.ts**: Row serialization for root and nested rows. Must not format display values beyond `{ kind, value }`.
- **executor/schema-loaders.ts**: Visible schema loading with user isolation. Shared by `references.ts` and the executor — every source path must go through it.
- **executor/{rows,source-matches,first,time-series}.ts**: Per-output and per-source execution strategies.
- **time-series-buckets.ts**: Bucket alignment shared by validator and executor. Pure, no DB.

## Conventions

- Keep `routes.ts` thin and keep request/response contracts in `contract.ts` and `language.ts`.
- Safety-limit constants live in `validator/shared.ts` (validation limits) and `executor/types.ts` (runtime caps).
- When changing the query language, update `README.md` in this directory and the examples in `tests/src/fixtures/query-engine.ts` and `tests/src/tests/query-engine.test.ts`.
