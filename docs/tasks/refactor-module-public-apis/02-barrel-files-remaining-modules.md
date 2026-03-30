# Create Barrel Files for Remaining Modules

**Parent Plan:** [Refactor: Module Public APIs via Barrel Files](./README.md)

**Type:** AFK

**Status:** completed

## What to build

Create `index.ts` barrel files for the eight remaining feature modules. These modules have fewer
cross-module callers than the high-traffic group in Task 01, but must also have public contracts
before callers are migrated in Task 03.

Modules to cover:

1. `modules/entities`
2. `modules/events`
3. `modules/trackers`
4. `modules/sandbox`
5. `modules/media`
6. `modules/uploads`
7. `modules/system`
8. `modules/authentication`

Same rules apply as Task 01: re-export types, service functions, and factory constants that
cross-module callers use. Never re-export from `repository.ts`. Routes are never re-exported
(only `app/api.ts` mounts routes directly).

For modules with no current cross-module callers (e.g., `uploads`, `system`), still create a
minimal `index.ts` to establish the pattern and prevent future sub-path imports.

Refer to the [Implementation Recommendations table](./README.md#what-each-module-should-expose-via-indexts)
in the parent RFC for the expected export list per module.

## Acceptance criteria

- [x] `modules/entities/index.ts` exists and exports its cross-module types and service functions
- [x] `modules/events/index.ts` exists and exports its cross-module types and service functions
- [x] `modules/trackers/index.ts` exists and exports its cross-module types and service functions
- [x] `modules/sandbox/index.ts` exists and exports its cross-module types and service functions
- [x] `modules/media/index.ts` exists and exports its cross-module types and service functions
- [x] `modules/uploads/index.ts` exists (may be minimal if no cross-module callers)
- [x] `modules/system/index.ts` exists (may be minimal if no cross-module callers)
- [x] `modules/authentication/index.ts` exists and exports bootstrap functions used by `lib/db/seed/`
- [x] No repository functions are re-exported from any barrel
- [x] `bun tsc --noEmit` passes with no new errors

## Blocked by

None — can start immediately (independent of Task 01).

## User stories addressed

- Completes the public contract surface for all modules so the full caller migration (Task 03) is unblocked
