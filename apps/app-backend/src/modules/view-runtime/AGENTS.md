# View Runtime Agent Notes

- Keep `routes.ts` thin and keep request/response contracts in `schemas.ts`.
- Treat runtime as a query-and-field-resolution module; UI layout concerns belong outside this module.
- Keep field reference validation centralized in `~/lib/views/validator.ts` and reference parsing in `~/lib/views/reference.ts`.
- Keep SQL shaping centralized in `query-builder.ts` and field value resolution in `display-builder.ts`.
- When changing the runtime language, update `README.md` in this directory and the examples in `tests/src/fixtures/view-runtime.ts`, `tests/src/test-support/view-runtime-suite.ts`, and `tests/src/tests/view-runtime.test.ts`.
