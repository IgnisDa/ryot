# Codebase Cleanup

**Parent Plan:** [Integrations](./README.md)

**Type:** AFK

**Status:** done

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to duplicate code, duplicate or alias-only types, dead code, unnecessary exports, shallow wrappers, stale support artifacts, and speculative abstractions. The cleanup is scoped to touched files and directly affected modules, not unrelated opportunistic refactors.

Modules touched by this plan:
- `src/lib/db/schema/` (new tables, modified tables)
- `src/lib/config/` (new config fields)
- `src/lib/sandbox/` (new host function, driver validation, new scripts)
- `src/lib/queue/` (new worker registration)
- `src/lib/redis-keys.ts` (if extended for claimCachedValue)
- `src/modules/builtins/` (new event schemas, relationship schema, preference field, trigger links)
- `src/modules/events/` (before-trigger phase, EventWriteContext, skip results)
- `src/modules/collections/` (event emission, transaction scope)
- `src/modules/entities/` (generic library membership helpers, getEntityById extended query)
- `src/modules/imports/` (EventWriteContext threading, enum extensions)
- `src/modules/integrations/` (entire new module)
- `src/modules/legacy-bootstrap/` (three new/modified files)
- `src/app/runtime.ts` (scheduler reconciliation call)
- `src/app/server.ts` (`/_i` route)
- `src/app/api.ts` (integrations route registration)

## Acceptance criteria

- [x] The task is executed using the `codebase-cleanup` skill
- [x] The cleanup pass covers all files touched by this plan and any directly affected modules
- [x] Any removals or simplifications are reflected in the changed code before the plan is considered complete

## Cleanup performed

- `apps/app-backend/src/modules/integrations/service.ts` and `worker.ts`: deduplicated the integration-run `inputSummary` builder and the `disableIntegrations` preference lookup so both webhook and queue paths use the same helpers.
- `apps/app-backend/src/modules/integrations/schemas.ts`: converted `isSinkProvider` into a type guard and removed the stale unsafe-assertion suppression.
- `apps/app-backend/src/modules/integrations/providers/sink/shared.ts`: aligned the local schema import with the rest of the integrations module by using `@hono/zod-openapi`.
- `apps/app-backend/src/modules/integrations/providers/yank/plex-yank.ts`: documented the intentional no-op progress adapter so the owned-items-only behavior is explicit.
- `docs/tasks/integrations/README.md`, `03-collection-events-and-ownership.md`, and `05-yank-integration-adapters.md`: removed stale ownership-helper placement details, corrected the imports write-path location so `entities`/`events` stay generic, and fixed the plan status now that the cleanup pass is complete.
