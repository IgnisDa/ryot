# Query Engine

`README.md` owns query-language semantics, response shapes, limits, and examples.

- `@ryot/contract` owns the DSL and response schemas.
- Keep semantic validation pure; only reference validation may load visible schemas.
- Keep SQL compilation total and free of DB access and Effect. Never fall back to application-side row evaluation.
- Every root and traversal must use visible-schema loading and root-source builders.
- Executors issue one SQL query per output; reconstruction and reshaping must not construct SQL.
- Keep validation limits in `validator/shared.ts` and the transaction-local timeout in `service.ts`.
- Query-language changes must update `README.md`, `tests/src/fixtures/query-engine.ts`, and the query-engine e2e tests.
