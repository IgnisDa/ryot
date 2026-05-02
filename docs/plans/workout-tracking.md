# Workout Tracking — Implementation Plan

## Overview

Add workout tracking to the V2 backend by fitting workout sessions and their
sets into the existing entity/event model. A workout is a user-owned `workout`
entity. Each set performed in that workout is a `workout-set` event on the
target exercise entity, linked back to the workout entity via a new
`sessionEntityId` column on the `event` table.

No dedicated workout routes are introduced. All CRUD flows for workouts use the
existing entity endpoints; all set-logging and set-querying flows use the
existing event endpoints once they are extended to support `sessionEntityId`.

---

## Data Model

### `workout` entity schema (new, Fitness tracker)

Entity-level field: `entity.name` stores the workout name (e.g. "Push Day").

Properties AppSchema (`src/lib/fitness/workout.ts`):

| Field | AppSchema type | Required |
|---|---|---|
| `startedAt` | `datetime` | yes |
| `endedAt` | `datetime` | no |
| `comment` | `string` | no |
| `caloriesBurnt` | `integer` | no |

### `workout-set` event schema (new, on `exercise` entity schema)

Properties AppSchema (`src/lib/fitness/workout.ts`):

| Field | AppSchema type | Required | Notes |
|---|---|---|---|
| `setLot` | `string` enum | yes | `normal` \| `warm_up` \| `drop` \| `failure` |
| `exerciseOrder` | `integer` | yes | 0-indexed position of exercise in the workout |
| `setOrder` | `integer` | yes | 0-indexed position of set within its exercise |
| `reps` | `number` | no | |
| `weight` | `number` | no | kg |
| `duration` | `number` | no | seconds |
| `distance` | `number` | no | km |
| `rpe` | `integer` | no | 0–10 |
| `note` | `string` | no | |

`exerciseOrder` + `setOrder` allow deterministic workout reconstruction without
relying on `createdAt` ordering (important for imports and offline-first
clients).

### Entity ownership

| Record | `userId` |
|---|---|
| `exercise` entity | `NULL` (global, seeded) |
| `workout` entity | `user.id` (always private) |
| `workout-set` event | `user.id` |
| `workout-set` event `.entityId` | → global exercise entity |
| `workout-set` event `.sessionEntityId` | → user's workout entity |

---

## Change List

### 1. `apps/app-backend/src/lib/db/schema/tables.ts`

Add `sessionEntityId` to the `event` table:

```typescript
sessionEntityId: text().references(() => entity.id, { onDelete: "set null" }),
```

Add a B-tree index:

```typescript
index("event_session_entity_id_idx").on(table.sessionEntityId),
```

### 2. `apps/app-backend/src/lib/db/schema/relations.ts`

Add the event-side of the session entity Drizzle relation (entity side already
exists at line 101):

```typescript
// Add to eventRelations
sessionEntity: one(entity, {
    references: [entity.id],
    relationName: "sessionEntity",
    fields: [event.sessionEntityId],
}),
```

### 3. `bun run db:generate` in `apps/app-backend/`

Emit the migration SQL file for the new column. Commit the generated file
alongside the schema change.

### 4. New file: `apps/app-backend/src/lib/fitness/workout.ts`

Define two AppSchema objects following the pattern in
`src/lib/fitness/exercise.ts`:

- `workoutPropertiesJsonSchema` — for the `workout` entity schema
- `workoutSetPropertiesJsonSchema` — for the `workout-set` event schema

Both follow the `toAppSchemaProperties` / manual enum pattern used in
`exercise.ts`.

### 5. `apps/app-backend/src/modules/authentication/bootstrap/manifests.ts`

Three additive changes:

**a. Add `workout` to `authenticationBuiltinEntitySchemas`:**

```typescript
{
    icon: "dumbbell",
    slug: "workout",
    name: "Workout",
    eventSchemas: [],
    trackerSlug: "fitness",
    accentColor: "#2DD4BF",
    propertiesSchema: workoutPropertiesJsonSchema,
},
```

**b. Add `workout-set` event schema to the `exercise` entry** (currently
`eventSchemas: []`):

```typescript
eventSchemas: [{
    slug: "workout-set",
    name: "Workout Set",
    propertiesSchema: workoutSetPropertiesJsonSchema,
}],
```

**c. Add `all-workouts` saved view to `authenticationBuiltinSavedViews`:**

```typescript
{
    slug: "all-workouts",
    name: "All Workouts",
    trackerSlug: "fitness",
    entitySchemaSlug: "workout",
    displayConfiguration: createDefaultDisplayConfiguration("workout"),
},
```

### 6. `apps/app-backend/src/modules/saved-views/constants.ts`

Add a `workout` case to `createEntityCardConfig`:

```typescript
if (slug === "workout") {
    return {
        calloutProperty: null,
        primarySubtitleProperty: createEntityPropertyExpression(slug, "startedAt"),
        secondarySubtitleProperty: createEntityPropertyExpression(slug, "endedAt"),
    };
}
```

Add a `workout` case to `buildTableColumnsForSlug`:

```typescript
.with("workout", () => [
    nameColumn,
    { label: "Started At", expression: createEntityPropertyExpression(slug, "startedAt") },
    { label: "Ended At",   expression: createEntityPropertyExpression(slug, "endedAt") },
])
```

### 7. `apps/app-backend/src/modules/events/schemas.ts`

**a. Add optional `sessionEntityId` to `createEventBody`:**

```typescript
sessionEntityId: nonEmptyTrimmedStringSchema.optional(),
```

**b. Make `entityId` optional in `listEventsQuery` and require at least one
of `entityId` or `sessionEntityId` via `.refine()`:**

```typescript
export const listEventsQuery = z
    .object({
        entityId: nonEmptyTrimmedStringSchema.optional(),
        sessionEntityId: nonEmptyTrimmedStringSchema.optional(),
        eventSchemaSlug: nonEmptyTrimmedStringSchema.optional(),
    })
    .refine(
        (q) => q.entityId !== undefined || q.sessionEntityId !== undefined,
        { message: "Either entityId or sessionEntityId is required" },
    );
```

### 8. `apps/app-backend/src/modules/events/repository.ts`

**a. Update `createEventForUser`** to accept and persist optional
`sessionEntityId`:

```typescript
export const createEventForUser = async (input: {
    ...
    sessionEntityId?: string;
}) => { ... }
```

**b. Add `getSessionEntityScopeForUser`** — same query shape as
`getEntityScopeForUser`, used to validate the session entity before linking it:

```typescript
export const getSessionEntityScopeForUser = async (input: {
    userId: string;
    sessionEntityId: string;
}) => { ... }
```

**c. Update `listEventsByEntityForUser`** to branch on `entityId` vs
`sessionEntityId` filter (accept both as optional, apply whichever is present):

```typescript
export const listEventsByEntityForUser = async (input: {
    userId: string;
    entityId?: string;
    sessionEntityId?: string;
    eventSchemaSlug?: string;
}) => { ... }
```

### 9. `apps/app-backend/src/modules/events/service.ts`

**a. Add `getSessionEntityScopeForUser` to `EventServiceDeps`** and its default
binding.

**b. Update `createEvent`** to validate `sessionEntityId` when present:
after validating the primary entity and event schema, call
`getSessionEntityScopeForUser`; return `not_found` if the session entity is
absent or inaccessible to the user. Pass `sessionEntityId` through to
`createEventForUser`.

**c. Update `listEntityEvents`** to accept and forward either `entityId` or
`sessionEntityId` to the repository.

---

## Tests

### Unit tests: `apps/app-backend/src/modules/events/service.test.ts`

Add the following cases to the existing `describe("createEvent")` block:

| Test | Assertion |
|---|---|
| creates a workout-set event and passes `sessionEntityId` to the repository | captured `sessionEntityId` in `createEventForUser` equals input value |
| creates an event with no `sessionEntityId` and does not set it in the repository | `createEventForUser` called with `sessionEntityId: undefined` |
| returns `not_found` when `sessionEntityId` refers to a non-existent entity | `{ error: "not_found", message: "Session entity not found" }` |
| returns `not_found` when `sessionEntityId` refers to an entity not accessible to the user | `{ error: "not_found", message: "Session entity not found" }` |

Add a new `describe("listEntityEvents")` block (currently untested beyond
`not_found`):

| Test | Assertion |
|---|---|
| returns events when filtering by `sessionEntityId` | `serviceData([...])` returned |
| returns `not_found` when `sessionEntityId` refers to a non-existent session entity | `{ error: "not_found" }` |

### New test fixtures: `apps/app-backend/src/lib/test-fixtures/`

**`property-schemas.ts`** — add `createWorkoutSetPropertiesSchema()` returning
the AppSchema for `workout-set` event properties.

**`events.ts`** — add:
- `createBuiltinWorkoutSetEventDeps()` — dep preset where the entity is a
  global exercise entity and the event schema is `workout-set`
- Update `createEventDeps` to include a default no-op for the new
  `getSessionEntityScopeForUser` dep
- Update `createEventBody` defaults to include `sessionEntityId?: string`

### New E2E fixture: `tests/src/fixtures/workouts.ts`

```typescript
export async function createWorkoutEntityFixture(client, cookies)
// Finds the fitness tracker, resolves the "workout" entity schema ID,
// creates a workout entity via POST /entities, returns { workoutId, workoutSchemaId }

export async function findWorkoutSetEventSchema(client, cookies)
// Finds the exercise entity schema, lists its event schemas, returns the
// "workout-set" schema object

export async function waitForSessionEventCount(
    client, cookies, sessionEntityId, expectedCount, options?)
// Polls GET /events?sessionEntityId=... until >= expectedCount events are present
```

Export all three from `tests/src/fixtures/index.ts`.

### New E2E test file: `tests/src/tests/workouts.test.ts`

```
describe("Workouts E2E")
```

| Test | What it exercises |
|---|---|
| links the built-in workout schema to the fitness tracker | bootstrap manifest, tracker–schema link |
| workout schema has correct properties schema fields | `startedAt`, `endedAt`, `comment`, `caloriesBurnt` present in `propertiesSchema.fields` |
| creates the built-in workout-set event schema on exercise | bootstrap manifest, event schema seeded on exercise entity schema |
| workout-set event schema has correct property fields | `setLot`, `exerciseOrder`, `setOrder`, `reps`, `weight` present |
| creates the built-in All Workouts saved view with workout display defaults | `queryDefinition.scope = ["workout"]`, display config has `startedAt` as primary subtitle |
| creates a workout entity via the entity endpoint | POST /entities with workout schema ID → 200, entity returned with `properties.startedAt` |
| logs a workout set linked to a workout via sessionEntityId | POST /events with `sessionEntityId` + `entityId` (exercise) → set persists |
| listing events by sessionEntityId returns only sets for that workout | log 2 sets on W1, 1 set on W2; GET /events?sessionEntityId=W1 returns exactly 2 |
| listing events by entityId spans all workouts for that exercise | log sets from same exercise in 2 workouts; GET /events?entityId=exerciseId returns all |
| GET /events with neither entityId nor sessionEntityId returns 422 | missing both filter params → HTTP 422 |
| sets from one workout do not appear when querying another workout | GET /events?sessionEntityId=W2 does not include W1's sets |

---

## What is intentionally deferred

| V1 feature | Reason for deferral |
|---|---|
| Personal bests (`one_rm`, max weight, max reps) | Derivable from event queries; can be added as a script or background job later |
| Exercise history in `user_to_entity` | Derivable: `GET /events?entityId={exercise}&eventSchemaSlug=workout-set` |
| Workout templates | UX feature; no distinct data-model requirement |
| Superset grouping | Add `supersetGroup` field to `workout-set` properties schema when needed |
| Calories-burnt auto-calculation | Left as an optional user-supplied property |
| `repeated_from` (copy another workout) | Application-layer operation; no schema change needed |
| Exercise-level notes per workout | Can be added as `exerciseNote` field to `workout-set` properties schema later |
