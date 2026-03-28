# App Backend Guidelines

## Product Context

### Purpose

Ryot's backend powers a self-hosted personal tracking product. It should protect user ownership of data, stay predictable for self-hosted deployments, and make it easy for the frontend to consume stable, well-validated APIs.

Backend changes should preserve the product's platform nature: users can track media, fitness, and custom trackers, so backend abstractions must stay flexible without becoming vague or weakly typed.

### Reliability Goals

The backend should favor explicit validation, stable contracts, and small composable helpers over clever implicit behavior. Error paths should be unsurprising, persistence logic should be easy to audit, and API responses should remain consistent across modules.

## Engineering Guardrails

### Type Safety

- When a zod schema exists, derive TypeScript types from it with `z.infer` instead of maintaining parallel handwritten request or response types.
- Treat schema files as the source of truth for backend payload shapes. If a service, repository, or route needs the same shape, import the inferred type instead of recreating it.
- Prefer `Pick`, `Omit`, indexed access types, and shared inferred aliases before introducing new bespoke interfaces.
- Keep distinct manual types only when they represent a genuinely different post-validation or post-persistence shape.
- If a database json/jsonb column stores a validated structure, keep one shared schema/type authority for that structure and cast or normalize in one place.

### Validation

- Put reusable payload schemas in module `schemas.ts` files and keep route request bodies/queries/params aligned with them.
- Prefer schema-backed validation paths over ad hoc manual checks when behavior stays clear.
- Use shared helpers like `resolveValidationData` for route-level validation plumbing instead of repeating `try/catch` to build 400 responses.
- If custom validation behavior is required, keep the custom logic narrow and layered on top of the schema instead of replacing the schema entirely.

### Routes And OpenAPI

- Route modules should stay thin: parse input, resolve access, call service/repository helpers, and return OpenAPI-safe responses.
- Reuse `createAuthRoute`, shared error helpers, and shared access-error helpers instead of rebuilding response envelopes per route.
- Keep OpenAPI request and response schemas colocated with the module they describe.
- When multiple routes in the same module share identical not-found or validation results, extract small local constants/helpers instead of repeating literals.
- If schemas change, update the OpenAPI spec by running `bun run --filter=@ryot/generated app-backend-openapi`. Make sure you have the dev server running before you run this command.

### Repositories And Drizzle

- Repository modules should centralize repeated Drizzle `select` and `returning` projections into shared constants when the same shape is used more than once.
- Keep row-to-domain normalization in one helper per module when json fields or nullable fields need conversion.
- Prefer small repository functions with explicit inputs over broad helper functions with many optional behaviors.
- Let services handle business rules and normalization; let repositories focus on persistence and retrieval.

### Schema And Database Modeling

- Keep runtime validation schemas, persisted json structures, and inferred TypeScript types aligned. Avoid letting any one of the three drift from the others.
- If a type is already represented in `src/lib/db/schema/tables.ts` or a module `schemas.ts`, extend or refine that source instead of cloning the shape elsewhere.
- For recursive property-schema work, update the shared property schema builders first and keep downstream parsing logic minimal.

### Testing And Verification

- For backend-only changes, run `bun run typecheck`, `bun test`, and `bun run lint` in `apps/app-backend` unless the change is purely editorial.
- When refactoring validation behavior, update tests to reflect the intended new contract instead of preserving legacy wording by default.
- Prefer focused tests around service validation and schema behavior when changing input normalization rules.
