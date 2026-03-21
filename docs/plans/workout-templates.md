# Workout Templates - Implementation Plan

## Overview

Add built-in workout templates to `apps/app-backend` as a first-class fitness entity schema.

Workout templates should look and feel close to workouts, but the exercises and sets live in the template entity itself as structured JSON data. The backend should also seed a dedicated relationship schema for linking a workout to the template it was created from.

This is a greenfield feature. Migration and backward compatibility are out of scope.

## Target Model

### `workout-template` entity schema

File: `apps/app-backend/src/lib/fitness/workout-template.ts`

The template entity should be a built-in schema under the `fitness` tracker.

Suggested properties:

- `comment`
- `exercises`
- `supersets`

Each exercise should carry the workout-plan data directly in the entity JSON, including the nested set records.

The exact shape does not need to match the Rust backend one-to-one, but it should preserve the same idea: templates store workout structure, not workout events.

### Relationship schema

Seed a builtin relationship schema for workout-to-template linking.

Suggested direction:

- source: `workout`
- target: `workout-template`

This allows the workout entity to point at its source template through the existing `relationship` table and query-engine relationship joins.

## Backend Changes

### 1. `apps/app-backend/src/lib/fitness/workout-template.ts`

Add a new Zod/AppSchema definition for the workout-template entity properties.

Keep the schema nested and explicit so the entity can store structured template data directly.

### 2. `apps/app-backend/src/modules/authentication/bootstrap/manifests.ts`

Add the new `workout-template` entity schema to `authenticationBuiltinEntitySchemas()`.

Add a builtin relationship schema for the workout/template link to `authenticationBuiltinRelationshipSchemas()`.

Add a built-in saved view for `workout-template` to `authenticationBuiltinSavedViews()`.

### 3. `apps/app-backend/src/modules/saved-views/constants.ts`

Add a `workout-template` branch to the default display configuration helper so the saved view gets sensible card/table defaults.

### 4. Relationship write path

Reuse the existing relationship storage helpers in `modules/entities` for the workout-template link.

The feature only needs the schema and storage capability; no general relationship CRUD surface should be added unless a later flow explicitly needs it.

### 5. `apps/app-backend/src/app/api.ts`

Only update if a new route is added for writing the workout-template relation.

If the relationship link stays internal for now, no API wiring is needed.

## Tests

### Unit

Add coverage for the default display configuration branch in `apps/app-backend/src/modules/saved-views/constants.test.ts`.

### E2E

Add workout-template coverage under `tests/src/tests/` with helpers in `tests/src/fixtures/`.

The suite should verify:

- the built-in workout-template schema is linked to the fitness tracker
- the schema exposes the nested template properties
- the built-in `All Workout Templates` saved view exists
- a workout-template entity round-trips through `POST /entities` and `GET /entities/:id`
- template entities can be added to collections
- the workout/template relationship schema can be used in a relationship join

## Notes

- Keep the schema close to workouts, but do not force a Rust backend copy.
- Store sets and reps inside the template entity JSON, not as events.
- Keep the change small and focused on the new workout-template flow.
