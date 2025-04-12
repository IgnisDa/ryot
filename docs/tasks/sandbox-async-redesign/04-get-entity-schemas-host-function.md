# `getEntitySchemas` Host Function

**Parent Plan:** [Sandbox Async Redesign](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add the `getEntitySchemas` host function — the first function in the system with a real non-empty context (`{ userId: string }`). Its presence validates the full descriptor path: context binding at enqueue time, serialization through BullMQ, cross-instance reconstruction from the registry, and forwarding to a live database-backed service.

Specifically:

- Create `src/lib/sandbox/host-functions/get-entity-schemas.ts`:
  - Context type: `{ userId: string }`.
  - Argument from script: `slugs: unknown` — validate that it is a `string[]`; return `apiFailure` if not.
  - Implementation: delegate to `listEntitySchemas({ userId: context.userId, slugs })`.
  - Return: `apiSuccess(data)` with the full `ListedEntitySchema[]` shape, or `apiFailure(message)` if the service returns an error.
- Register it in `function-registry.ts` as a stateful factory: `(ctx) => (...args) => getEntitySchemas(ctx as { userId: string }, ...args)`.
- Update the `POST /sandbox/enqueue` route handler to include a `getEntitySchemas` descriptor with `context: { userId: user.id }`.
- Write unit tests with a mocked `listEntitySchemas` service: valid slug array forwards `userId` and `slugs` correctly; invalid `slugs` argument returns `apiFailure`; service error is propagated as `apiFailure`.

See the **`getEntitySchemas` host function** section of the parent PRD for the precise contract.

## Acceptance criteria

- [ ] `get-entity-schemas.ts` exists and exports `getEntitySchemas` with `context: { userId: string }` as its first parameter.
- [ ] Passing a non-array `slugs` argument returns `apiFailure` with a descriptive message.
- [ ] Passing a valid `string[]` calls `listEntitySchemas` with the correct `userId` from context and `slugs` from args.
- [ ] A service-level error from `listEntitySchemas` is returned as `apiFailure`.
- [ ] `getEntitySchemas` is registered in `hostFunctionRegistry` under the key `"getEntitySchemas"`.
- [ ] The `POST /sandbox/enqueue` route handler includes a `getEntitySchemas` descriptor with `context: { userId: user.id }`.
- [ ] Unit tests pass for all three paths above.
- [ ] `bun run typecheck`, `bun test`, and `bun run lint` pass in `apps/app-backend`.

## Blocked by

- [Task 01](./01-foundation-types-convention-registry.md)
- [Task 03](./03-new-api-endpoints.md)

## User stories addressed

- User story 2 (new function added by implementing + registering in one place)
- User story 4 (non-empty `{ userId }` context flows through descriptor to function)
- User story 19 (script can call `getEntitySchemas(["slug-a"])` and receive full schema objects)
- User story 20 (all four functions available in script scope)
- User story 21 (script `context` variable still accessible)
