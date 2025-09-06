# Workout Import Tracer Bullet

**Parent Plan:** [V2 Importing Infrastructure](./README.md)

**Type:** AFK

**Status:** done

## What to build

Port the Hevy and StrongApp workout import behavior into the V2 import pipeline. This slice should prove user-owned custom exercise matching/creation, workout entity creation, workout-set event creation with `sessionEntityId`, derived set statistics, and item-level workout import failures.

Follow the parent PRD section "Fitness Workouts And Exercises". Imported exercises are user-owned custom `exercise` entities with no provider script when no exact normalized user/global match exists. Exercise matching is case-insensitive normalized name plus `kind`, with exact normalized matching only. Relax `exercise.level` to optional rather than inventing a default. Imported workout-set events must compute `volume`, `pace`, and `oneRm` when possible using the V1 formulas.

## Acceptance criteria

- [x] Hevy and StrongApp source input schemas and adapters are added under the imports module.
- [x] Adapters group source rows into workouts and exercises according to V1 semantics while returning V2-native normalized workout items and item failures.
- [x] Imported custom exercises reuse existing user-owned and global exercises by normalized name plus `kind` before creating a new user-owned exercise.
- [x] Imported custom exercises use `images: []`, `muscles: []`, `instructions: []`, inferred `kind`, and omit optional fields.
- [x] The exercise schema no longer requires `level`; existing exercise validation and tests are updated.
- [x] Each imported workout creates a user-owned `workout` entity with `startedAt`, `endedAt`, and comments where available.
- [x] Each imported set creates a `workout-set` event on the exercise entity with `sessionEntityId` pointing to the workout entity.
- [x] Workout-set `occurredAt` equals workout `startedAt`.
- [x] Set events include `exerciseOrder`, `setOrder`, `setLot`, raw stats, and computed `volume`, `pace`, and `oneRm` when possible.
- [x] No V2 workout revision scheduler is added or invoked.
- [x] Unit tests cover exercise matching, custom exercise creation, workout/set event creation, and derived field formulas.
- [x] The workout import slice tests assert computed `oneRm`, `pace`, and `volume`.

## User stories addressed

Reference by number from the parent PRD:

- User story 18
- User story 19
- User story 20
- User story 22
- User story 23
