# App Backend Guidelines

## Product Context

The backend powers a self-hosted personal tracking product. Favor explicit validation, stable contracts, and small composable helpers over clever implicit behavior. Error paths should be unsurprising, persistence logic easy to audit, and API responses consistent across modules.

## Engineering Guardrails

### Type Safety

- Derive TypeScript types from zod schemas with `z.infer`; treat schema files as the source of truth.
- Use `Pick`, `Omit`, and indexed access types before adding new interfaces.
- Avoid parallel hand-written types when an inferred alias covers the same shape.

### Validation

- Put reusable schemas in module `schemas.ts` files.
- Use `resolveValidationData` for route validation instead of ad hoc `try/catch` 400 responses.
- Keep custom validation narrow and layered on top of schemas.

### Routes And OpenAPI

- Routes should be thin: parse input, check access, call service/repo, return response.
- Use `createAuthRoute`, shared error helpers, and shared access-error helpers.
- Keep OpenAPI schemas colocated with their module.
- OpenAPI types at `libs/generated/src/openapi/app-backend.d.ts` are generated automatically when the backend starts in development.

### Repositories And Drizzle

- Centralize repeated Drizzle projections into shared constants.
- Keep row-to-domain normalization in one helper per module.
- Let services own business rules; let repositories own persistence.

### Module Imports

- Import from module barrels (`~/modules/X`) not sub-paths (`~/modules/X/service`). Each module's `index.ts` defines its public API.

### Schema And Database Modeling

- Keep runtime schemas, persisted JSON structures, and TypeScript types aligned.
- Extend existing types from `src/lib/db/schema/tables.ts` or module `schemas.ts` instead of cloning shapes.

### Testing

- For changes, run `bun run typecheck`, `bun run test`, and `bun run lint` in `apps/app-backend`.
- Write only pure functional tests that don't require external state or side effects.
- Add end to end tests in `<root>/tests/src` as appropriate.
- Prefer shared test fixtures in `src/lib/test-fixtures` for repeated test data and mock deps.
- Keep test definitions and assertions inline; extract duplicated setup, not test intent.
- Favor module-specific fixture files; only put truly cross-module primitives in shared helpers.
- Fixtures should return fresh values and support partial overrides; avoid mutable shared state.

### Code Review

After completing meaningful backend work (endpoints, service logic, repository changes, auth, workers, error handling), launch the `backend-code-reviewer` agent before marking tasks complete or creating commits. Skip for trivial changes and pure formatting.

**Workflow:**

1. Ensure all tests pass
2. Launch `backend-code-reviewer` via the Task tool; provide context on what changed and which files
3. Address any issues identified
4. Re-run tests, then mark the task complete
