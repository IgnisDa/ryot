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
- After schema changes, regenerate the spec: `bun run --filter=@ryot/generated app-backend-openapi` (requires dev server running).

### Repositories And Drizzle

- Centralize repeated Drizzle projections into shared constants.
- Keep row-to-domain normalization in one helper per module.
- Let services own business rules; let repositories own persistence.

### Schema And Database Modeling

- Keep runtime schemas, persisted JSON structures, and TypeScript types aligned.
- Extend existing types from `src/lib/db/schema/tables.ts` or module `schemas.ts` instead of cloning shapes.

### Testing

- For backend changes, run `bun run typecheck`, `bun test`, and `bun run lint` in `apps/app-backend`.

### Code Review

After completing meaningful backend work (endpoints, service logic, repository changes, auth, workers, error handling), launch the `backend-code-reviewer` agent before marking tasks complete or creating commits. Skip for trivial changes and pure formatting.

**Workflow:**

1. Ensure all tests pass
2. Launch `backend-code-reviewer` via the Task tool; provide context on what changed and which files
3. Address any issues identified
4. Re-run tests, then mark the task complete
