# Event Occurrence Semantics

**Parent Plan:** [V2 Importing Infrastructure](./README.md)

**Type:** AFK

**Status:** done

## What to build

Implement the event occurrence-time foundation described in the parent PRD sections "Event Occurrence Time", "Events And Triggers", "App Client Impact", "Legacy Bootstrap Impact", and "Migrations And Generated Types". This slice should make `occurredAt` the canonical product/event chronology field everywhere event order or state is derived, while keeping `createdAt` as row audit time.

Add the `event.occurredAt` database column and wire it through event schemas, event creation, repository selections, event listing, trigger context, query-engine event/event-join references, latest-event joins, backend media overview logic, app-client media overview query definitions, and legacy bootstrap event inserts. Existing app-client UI behavior should not gain new import UI; only update existing media overview/activity queries to use the new event chronology contract.

The event service's only defaulting rule is: `occurredAt` is optional; if omitted, it defaults to now. Historical or backdated callers are responsible for passing an explicit `occurredAt`; the generic event service does not inspect schema slugs or properties to infer a timestamp.

## Acceptance criteria

- [ ] `event.occurredAt` exists as a non-null timestamp with timezone and is included in Drizzle schema, generated migration SQL, selections, response schemas, and test fixtures.
- [ ] Event creation accepts optional `occurredAt`, validates it as an ISO datetime, persists it, and returns it in created/listed event data.
- [ ] Event creation defaults `occurredAt` to now when omitted; callers that need historical timestamps must pass `occurredAt` explicitly.
- [ ] Event listing orders by `occurredAt desc`, then `createdAt desc`, then `id desc`.
- [ ] Query-engine event and event-join references expose `occurredAt` alongside `createdAt` and `updatedAt`.
- [ ] Latest event joins use `occurredAt desc`, then `createdAt desc`, then `id desc`.
- [ ] Backend media overview state comparisons and activity chronology use `occurredAt` rather than `createdAt` or derived `completedOn` fallbacks.
- [ ] Sandbox trigger context includes `occurredAt`, `createdAt`, and `updatedAt` as ISO strings.
- [ ] App-client media overview query definitions in `apps/app-client/src/features/media/use-overview-data.ts` use `occurredAt` where state comparison, sort, or activity chronology is intended.
- [ ] Legacy bootstrap event inserts in `seen-mapping.ts`, `seen-completion-mapping.ts`, `review-mapping.ts`, and `workout-mapping.ts` write `occurred_at` using the same historical timestamp currently used for the event's product time.
- [ ] Unit tests cover event create/list/repository/defaulting/trigger context/query-engine reference behavior, and existing backend/client tests are updated from `createdAt` chronology to `occurredAt` chronology.

## User stories addressed

Reference by number from the parent PRD:

- User story 6
- User story 25
- User story 27
- User story 28
