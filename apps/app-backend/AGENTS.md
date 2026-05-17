# App Backend Guidelines

> Inherits from root `AGENTS.md`. Rules below are additive.

## Product Context

The backend powers a self-hosted personal tracking product. Favor explicit validation, stable contracts, and small composable helpers over clever implicit behavior.

## Engineering Guardrails

### Type Safety

- Treat module `schemas.ts` files as the source of truth; derive all TypeScript types from them.
- OpenAPI types at `libs/generated/src/openapi/app-backend.d.ts` are auto-generated in development.

### Validation

- Put reusable schemas in module `schemas.ts` files.
- Use `resolveValidationData` (`src/lib/openapi.ts`) instead of ad hoc `try/catch` 400 responses.

### Routes And OpenAPI

- Routes should be thin: parse input, check access, call service/repo, return response.
- Define routes with `createAuthRoute` (`src/lib/openapi.ts`).
- Response helpers (`createSuccessResult`, `createServiceErrorResult`, `createStandardResponses`, etc.) live in `src/lib/openapi.ts`. Use them — do not construct ad hoc JSON error responses.

### Error Handling

- Services return `ServiceResult<T, E>` (`src/lib/result.ts`): `{ data: T }` or `{ error: E, message: string }`. Use `serviceError` to construct errors.
- Access checks (`checkAccess`, `checkReadAccess`, `checkCustomAccess`) live in `src/lib/access/index.ts`.

### Repositories And Drizzle

- Centralize repeated Drizzle projections into shared constants.
- Keep row-to-domain normalization in one helper per module.
- Services own business rules; repositories own persistence.

### Module Imports

- Import from module barrels (`~/modules/X`) not sub-paths (`~/modules/X/service`).

### Schema And Database Modeling

- Keep runtime schemas, persisted JSON structures, and TypeScript types aligned.
- Extend existing types from `src/lib/db/schema/tables.ts` or module `schemas.ts` instead of cloning shapes.
- Always use `timestamp({ withTimezone: true })`; never bare `timestamp()`.
- JSONB date values must be ISO 8601 UTC strings. Use `dayjs().toISOString()`.

### Async Processing (BullMQ)

BullMQ with Redis. Infrastructure in `src/lib/queue/` and `src/lib/sandbox/`.

- **Queues**: `media`, `events`, `sandbox` in `src/lib/queue/queues.ts`, accessed via `getQueues()`.
- **Jobs**: Each module owns jobs (`src/modules/{module}/jobs.ts`) and workers (`src/modules/{module}/worker.ts`).
- **Dispatching**: `await getQueues().eventsQueue.add(jobName, payload)`. Use deterministic `jobId` for idempotency.
- **Naming**: Queues lowercase singular (`"media"`), jobs kebab-case (`"media-import"`).
- **Lifecycle**: `initializeQueues` → `initializeSandboxService` → `initializeWorkers` at startup; reverse on shutdown (30s timeout). See `src/app/runtime.ts`.

### Testing

- Run `bun run check`, `bun run test`, and `bun run format` after changes.
- Shared fixtures in `src/lib/test-fixtures`. Module-specific fixtures preferred; cross-module primitives only in shared helpers.
- E2E tests go in `<root>/tests/src`.

### Code Review

After meaningful backend work, launch `backend-code-reviewer` via the Task tool before committing. Skip for trivial changes. Ensure tests pass before and after review.

## Type/Schema/Relationship Write Path

### The `<type>` / `<type>_schema` pattern

Three instance types are validated against their corresponding schema's `propertiesSchema` on every write:

| Instance       | Schema table          | propertiesSchema column                                                                |
| -------------- | --------------------- | -------------------------------------------------------------------------------------- |
| `entity`       | `entity_schema`       | validated via `entities/service.ts:createEntity`                                       |
| `event`        | `event_schema`        | validated via `events/service.ts:createEvent`                                          |
| `relationship` | `relationship_schema` | validated via `writeRelationship` / `writeEntityRelationship` in `entities/service.ts` |

### Relationship writers

Two canonical service functions in `modules/entities/service.ts`:

- **`writeRelationship`** — validates `properties` against `relationship_schema.propertiesSchema` then calls `insertRelationship` (ON CONFLICT DO NOTHING). Used for simple user-scoped relationships.
- **`writeEntityRelationship`** — validates `extraProperties + role` then calls `upsertEntityRelationship` (roles accumulation with transaction lock). Used by the media worker for person/company/group credit relationships.

For collection membership (`member-of`), validation against `member-of.propertiesSchema` happens inside `collections/service.ts:addToCollection` after the collection-level `membershipPropertiesSchema` check.

### AppSchema top-level `unknownKeys`

`AppSchema` (in `@ryot/ts-utils/app-schema`) now accepts an optional top-level `unknownKeys?: "strip" | "strict" | "passthrough"`. Pass it to make `fromAppSchemaObject` produce a passthrough/strip Zod schema instead of the default strict one. The `member-of` and any other relationship schemas whose `propertiesSchema` must accept arbitrary top-level keys should use `unknownKeys: "passthrough"`.

### Collection entity properties

Collection entities store `{ description?, membershipPropertiesSchema? }` in their `properties` column. The builtin `collection` entity schema's `propertiesSchema` defines both fields (`description` as string, `membershipPropertiesSchema` as passthrough object). All collection entity writes are validated against this schema in `collections/service.ts:createCollection`.

### person-to-media relationship schemas

Person credit relationships include an optional `character` field (the role/character a person played). This field is declared in the person-to-media relationship schema's `propertiesSchema`. Company credit relationships do NOT have a `character` field.
