# Query Engine Agent Notes

- Keep `routes.ts` thin and keep request/response contracts in `schemas.ts`.
- Treat the query engine as a query-and-field-resolution module; UI layout concerns belong outside this module.
- Keep field reference validation centralized in `~/lib/views/validator.ts` and reference parsing in `~/lib/views/reference.ts`.
- Keep SQL shaping centralized in `query-builder.ts` and field value resolution in `display-builder.ts`.
- When changing the query language, update `README.md` in this directory and the examples in `tests/src/fixtures/query-engine.ts`, `tests/src/test-support/query-engine-suite.ts`, and `tests/src/tests/query-engine.test.ts`.
