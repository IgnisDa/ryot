# Cleanup Old Code

**Parent Plan:** [Sandbox Async Redesign](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Remove all code, types, exports, and references that belonged to the old synchronous sandbox design. By this point all prior tasks are complete and E2E tests are green, so this slice has no risk of breaking anything — it is purely cosmetic and structural tidying.

Specifically:

- **`jobs.ts`:** Remove `sandboxRunJobWaitTimeoutMs` (was used only by `waitUntilFinished`). Remove any remaining references to `apiFunctionsId`.
- **`types.ts`:** Remove the old `ApiFunction` type (or any transitional alias kept during earlier tasks). Confirm only `HostFunction<TContext>` and `ApiFunctionDescriptor` remain as the canonical sandbox types.
- **`service.ts`:** Confirm no dead private methods, unused imports, or transitional comments remain from the refactor.
- **`queues.ts` / `workers.ts` / `index.ts`:** Remove any lingering `QueueEvents` imports, type references, or shutdown hooks that were made redundant in Task 02.
- **`bridge.ts`:** Remove the `userIds` Map if it is no longer used after the refactor (it was previously maintained alongside `apiFunctions` — audit whether it is still needed).
- **Host function files:** Remove any unused imports, old type references, or leftover compatibility shims introduced during the migration.
- **`README.md`:** Update to reflect the final state — remove any notes that reference the old `run()` method, `waitUntilFinished`, or `apiFunctionsId`.
- Audit all sandbox-related files for `TODO`, `FIXME`, or transition comments left during implementation and resolve or remove them.
- Confirm no unused exports remain that were needed only as transitional scaffolding.

## Acceptance criteria

- [ ] `sandboxRunJobWaitTimeoutMs` is deleted and has no remaining references.
- [ ] The old `ApiFunction` type (pre-convention) is deleted if it was kept as a transitional alias.
- [ ] `QueueEvents` has no imports or references anywhere in `src/lib/queue/`.
- [ ] `bridge.ts` `userIds` Map is removed if it serves no purpose after the refactor.
- [ ] No `TODO` or `FIXME` comments remain in any sandbox or queue file.
- [ ] `README.md` accurately describes only the new design with no references to removed APIs.
- [ ] `bun run typecheck`, `bun test`, and `bun run lint` pass in `apps/app-backend`.
- [ ] `bun run typecheck`, `bun test`, and `bun run lint` pass in `tests/`.

## Blocked by

- [Task 05](./05-e2e-tests.md)

## User stories addressed

This task does not introduce new user-visible behaviour. It ensures the codebase is clean and maintainable for future contributors, supporting all user stories indirectly by reducing the surface area for confusion and bugs.
