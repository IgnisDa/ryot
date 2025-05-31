# Create Barrel Files for High-Traffic Modules

**Parent Plan:** [Refactor: Module Public APIs via Barrel Files](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Create `index.ts` barrel files for the five modules most imported by other modules. Do not touch
any existing callers — this slice only adds new files. Existing imports continue to work unchanged
because TypeScript resolves `~/modules/X` to `~/modules/X/index.ts` when the file exists.

The five modules in priority order (most imported first):

1. `modules/saved-views` — imported by `lib/views/`, `modules/authentication/`, `lib/test-fixtures/`
2. `modules/entity-schemas` — imported by `lib/sandbox/`, `lib/test-fixtures/`
3. `modules/query-engine` — imported by `lib/views/`, `modules/media/`
4. `modules/property-schemas` — imported by `lib/views/`
5. `modules/event-schemas` — imported by `lib/test-fixtures/`

Each `index.ts` re-exports:
- All types/schemas that cross-module callers currently import from sub-paths
- Service functions used by callers outside the module
- Factory/constant functions from `constants.ts` used by callers outside the module
- **Never** exports anything from `repository.ts`

Refer to the [Implementation Recommendations table](./README.md#what-each-module-should-expose-via-indexts)
in the parent RFC for the exact export list per module.

## Acceptance criteria

- [ ] `modules/saved-views/index.ts` exists and re-exports all types, service functions, and factory constants currently imported cross-module from its sub-paths
- [ ] `modules/entity-schemas/index.ts` exists and re-exports all types and service functions currently imported cross-module
- [ ] `modules/query-engine/index.ts` exists and re-exports `QueryEngineRequest`, `QueryEngineResponseData`, and `query-builder` exports used by `lib/views/`
- [ ] `modules/property-schemas/index.ts` exists and re-exports the schema objects used by `lib/views/definition.ts`
- [ ] `modules/event-schemas/index.ts` exists and re-exports all types and service functions used by `lib/test-fixtures/`
- [ ] No repository functions are re-exported from any of these barrels
- [ ] `bun tsc --noEmit` passes with no new errors

## Blocked by

None — can start immediately.

## User stories addressed

- Establishes a stable public contract for the most-used modules so callers stop reaching into internals
