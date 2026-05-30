# Before-Trigger Event System

**Parent Plan:** [Integrations](./README.md)

**Type:** AFK

**Status:** done

## What to build

Extend the event module with a new `before_create` trigger phase that runs sandbox scripts synchronously before an event is persisted. This is the generic DB-backed behavior extension mechanism that the integration progress-policy script (task 07) and any future pre-write policies will rely on.

Refer to the **Before-Trigger System** and **claimCachedValue Sandbox Host Function** sections of the parent PRD for the complete contract.

**Prerequisite:** Task 01 must be complete. The `event_schema_trigger.phase` and `position` columns must exist.

### 1. `EventWriteContext`

Define a new internal type in the events module:

```ts
type EventWriteContext = {
  origin: "api" | "import" | "integration" | "sandbox";
  integrationId?: string;
  importRunId?: string;
};
```

This is a server-side-only type. It must never be derivable from user API input. Thread it as an optional parameter through:

- `createEvent`
- `createEvents`
- `createEventsWithTriggers`
- `createEventsBestEffortWithTriggers`

When callers do not supply it, default to `{ origin: "api" }`. The imports pipeline (task 05/06) will pass `{ origin: "integration", integrationId, importRunId }`.

### 2. Before-trigger retrieval

Add a new repository query alongside `getActiveEventSchemaTriggersForEventSchemas`: retrieve active before-create triggers for a set of event schema IDs:

```ts
getActiveBeforeCreateTriggersForEventSchemas(input: { userId, eventSchemaIds })
```

Returns triggers where `phase = "before_create"` and `isActive = true`, ordered by `position` ascending. Both builtin (`userId IS NULL`) and user-owned triggers for the given user are included.

### 3. Before-trigger driver return schema

In `src/lib/sandbox/types.ts`, add a typed schema for before-trigger driver return values:

```ts
type BeforeTriggerResult =
  | { action: "allow" }
  | { action: "skip"; reason: string }
  | {
      action: "replace";
      body: {
        properties?: Record<string, unknown>;
        occurredAt?: string;
        sessionEntityId?: string | null;
      };
    }
```

The sandbox runner must validate the trigger driver's return value against this schema when `driverName === "trigger"` and the trigger is a before-create trigger. If the return value does not conform, treat it as a trigger failure (fail closed).

### 4. New before-trigger context shape

Before-trigger sandbox context contains raw (pre-validation) event input plus the write context:

```ts
context.trigger = {
  phase: "before_create",
  origin: string,
  userId: string,
  entityId: string,
  eventSchemaId: string,
  entitySchemaId: string,
  eventSchemaSlug: string,
  entitySchemaSlug: string,
  properties: Record<string, unknown>,   // raw, unvalidated
  occurredAt: string,
  sessionEntityId?: string,
  integrationId?: string,
  importRunId?: string,
}
```

Note: there is no `eventId` because the event has not been inserted yet.

### 5. Updated event creation flow

Rewrite `createEvent` to run before-create triggers between entity-in-library resolution and final property validation:

```
1. Resolve entity + event schema (as today).
2. Ensure entity in library if needed.
3. Build raw event input (entity ID, schema ID, raw properties, occurredAt, sessionEntityId).
4. Run before_create triggers in ascending position order:
   a. For each trigger: enqueue sandbox job and wait for result.
   b. If job errors, times out, or returns invalid shape → fail closed. Return error to caller.
   c. If result.action === "skip" → do not insert event. Return skip result.
   d. If result.action === "replace" → merge replacement into the event input object.
   e. If result.action === "allow" → continue.
5. Validate final (possibly replaced) event properties against the event schema.
   If validation fails → fail closed.
6. Insert event.
7. Run after_create triggers asynchronously (existing behavior, unchanged).
```

If any before trigger returns skip, stop immediately. No further before triggers run, no event is inserted, no after triggers run.

### 6. Updated skip result type from best-effort creation

`createEventsBestEffortWithTriggers` must return skipped items alongside created and failed:

```ts
{
  count: number,
  createdEvents: CreatedEventData[],
  failures: CreateEventsBestEffortFailure[],
  skipped: {
    itemIndex: number,
    reason: string,
    eventSchemaSlug: string,
    entityId: string,
  }[]
}
```

Skipped items are counted as processed but not imported in run counters. They do not produce `import_run_failure` records.

Update the `index.ts` barrel to export the new skip type.

### 7. Before-trigger failure → `import_run_failure`

When a before-trigger fails for an integration-triggered write (caller passes `importRunId`), the caller (the integration job worker in task 05/06) is responsible for creating an `import_run_failure` record with:

- `stage = "event_before_trigger"`
- `message` = the failure reason
- `itemIndex`, `entitySchemaSlug`, `sourceLabel`, `sourceIdentifier` from context

The events module itself does not write `import_run_failure` records. It simply returns the error to its caller.

### 8. `claimCachedValue` sandbox host function

Add `src/lib/sandbox/host-functions/claim-cached-value.ts`:

```ts
claimCachedValue(key: string, value: JsonValue, ttlSeconds: number)
```

Behavior:
- Validate context has non-empty `scriptId`, key is non-empty string, ttlSeconds is a positive integer.
- Redis key: `sandbox:cache:{scriptId}:{key.trim()}` (same key construction as `setCachedValue`).
- Execute `SET key serializedValue NX EX ttlSeconds`.
- If `NX` succeeds: return `{ success: true, data: { claimed: true } }`.
- If `NX` fails (key already exists): read and parse the existing value; return `{ success: true, data: { claimed: false, value: existingValue } }`.
- On any error: return `{ success: false, error: message }`.

Register in `src/lib/sandbox/function-registry.ts` alongside `getCachedValue` and `setCachedValue`. Available to all scripts, not before-trigger specific.

Add `claimCachedValue` to `redisKeys` / `redisValues` in `src/lib/redis-keys.ts` if needed for key/codec alignment (it shares the same `sandbox:cache:` key space as the existing cache).

### 9. Before-trigger job enqueueing

Before-trigger sandbox jobs are added to the existing `sandboxQueue` like after-trigger jobs. The difference is that the event creation path waits synchronously for their completion before continuing.

Use BullMQ's `job.waitUntilFinished(queueEvents, timeout)` pattern (or equivalent) to wait. The timeout uses the existing sandbox job timeout — do not add a new config field for this.

If the job exceeds the sandbox timeout, the wait throws and event creation fails closed.

### 10. Sandbox runner: driver return validation by phase

The sandbox worker must validate the driver return value when `driverName === "trigger"`. It must detect whether the trigger is before-create or after-create (passed in job data) and validate accordingly:

- `before_create`: validate against `BeforeTriggerResult` schema.
- `after_create`: no return value shape enforced (existing behavior).

If before-create validation fails, the job fails (which causes the waiting event creation to receive an error and fail closed).

## Acceptance criteria

- [x] `EventWriteContext` is threaded through all event creation paths. `origin: "api"` is the default when not supplied.
- [x] `createEvent` runs active `before_create` triggers in ascending position order before property validation.
- [x] A `skip` result from a before trigger causes `createEvent` to return a skip result without inserting the event or running after triggers.
- [x] A `replace` result merges properties/occurredAt/sessionEntityId into the event input. The replaced input undergoes full schema validation before insert.
- [x] A before-trigger job failure (error, timeout, invalid return shape) causes `createEvent` to fail closed with an error result.
- [x] `createEventsBestEffortWithTriggers` returns a `skipped` array alongside `failures` and `createdEvents`.
- [x] Skipped events do not create `import_run_failure` records.
- [x] `claimCachedValue` host function is registered and available to sandbox scripts.
- [x] `claimCachedValue` returns `{ claimed: true }` on first call; `{ claimed: false, value }` on subsequent calls within TTL.
- [x] Before-trigger context includes `phase`, `origin`, `userId`, raw `properties`, and optional `integrationId`/`importRunId`.
- [x] Existing after-trigger behavior is unchanged: after triggers fire only for events that were successfully inserted.
- [x] All new behavior is covered by unit tests following the patterns in `events/service.test.ts` and `events/trigger-processing.test.ts`.
- [x] `claimCachedValue` has unit tests following patterns in `sandbox/host-functions/set-cached-value.test.ts`.

## User stories addressed

- User story 28 (run failure includes stage information)
- User story 29 (skipped items do not appear as failures)
- User story 46 (before triggers run before property validation)
- User story 47 (skipped events do not create failures)
- User story 48 (event write context available in before-trigger scripts)
