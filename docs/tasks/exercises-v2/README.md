# Exercises Support in Ryot V2

## Problem Statement

Ryot V2 (`app-backend`) has a Media tracker but no Fitness tracker content. Users who used Ryot V1 could browse, search, and filter a comprehensive list of ~900 pre-seeded exercises (sourced from the `yuhonas/free-exercise-db` GitHub repository). V2 currently has no equivalent, leaving the Fitness tracker empty and unusable for exercise discovery.

## Solution

Seed all exercises from the `yuhonas/free-exercise-db` GitHub repository as global entities under a new builtin `exercise` entity schema, linked to the Fitness tracker. After seeding, users can immediately list, search, and filter exercises via the existing query engine. A builtin "All Exercises" saved view is created per user at registration so exercises are accessible from the Fitness tracker sidebar with no additional setup.

Seeding is triggered once on startup (via a BullMQ background job) if no exercise entities exist yet, keeping restarts fast after the initial seed.

## User Stories

1. As a user, I want to open the Fitness tracker and see an "All Exercises" view, so that I can browse the full exercise library without any manual setup.
2. As a user, I want to search exercises by name via the query engine, so that I can quickly find a specific exercise.
3. As a user, I want to filter exercises by muscle group, so that I can find exercises targeting a specific area.
4. As a user, I want to filter exercises by equipment, so that I can find exercises I can do with what I have.
5. As a user, I want to filter exercises by difficulty level (beginner/intermediate/expert), so that I can find exercises appropriate for my fitness level.
6. As a user, I want to filter exercises by force type (pull/push/static), so that I can plan balanced workouts.
7. As a user, I want to filter exercises by mechanic (compound/isolation), so that I can structure my training effectively.
8. As a user, I want to see an exercise's name and primary image when browsing the list, so that I can recognize exercises visually.
9. As a user, I want to see what muscles an exercise works, so that I can understand what it trains.
10. As a user, I want to see an exercise's step-by-step instructions, so that I can perform it correctly.
11. As a user, I want exercises to be available from the first time I open the app, so that I do not need to wait or manually import anything.
12. As a developer, I want exercises to be upserted on re-seed, so that changes to the GitHub dataset can be reflected without duplicating data.
13. As a developer, I want malformed or unmappable exercises from GitHub to be skipped with a warning, so that a single bad entry does not abort the entire seed.

## Implementation Decisions

### Exercise Entity Schema

- Builtin entity schema with slug `"exercise"`, name `"Exercise"`, icon `"dumbbell"`, accent color `"#2DD4BF"`.
- Linked to the `"fitness"` tracker at user registration time (via the existing `trackerSlug` mechanism in `authenticationBuiltinEntitySchemas`).
- No event schemas for now (workout logging is out of scope).
- No sandbox script linked (exercises are bulk-seeded; on-demand import flow is not needed).

### Exercise Properties Schema

Defined as an `AppSchema` with the following fields (all values snake_case):

| Field          | Type                   | Required | Notes                                                                                                                                                                                                                                                                     |
| -------------- | ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lot`          | enum                   | yes      | Mapped from GitHub `category`. Values: `reps`, `duration`, `reps_and_weight`, `reps_and_duration`, `distance_and_duration`, `reps_and_duration_and_distance`                                                                                                              |
| `level`        | enum                   | yes      | Directly from GitHub. Values: `beginner`, `intermediate`, `expert`                                                                                                                                                                                                        |
| `source`       | enum                   | yes      | Always `github` for seeded exercises. Values: `github`, `custom`                                                                                                                                                                                                          |
| `force`        | enum                   | no       | Directly from GitHub. Values: `pull`, `push`, `static`                                                                                                                                                                                                                    |
| `mechanic`     | enum                   | no       | Directly from GitHub. Values: `compound`, `isolation`                                                                                                                                                                                                                     |
| `equipment`    | enum                   | no       | Normalized from GitHub (e.g. `"body only"` → `"body_only"`). Values: `bands`, `cable`, `other`, `barbell`, `machine`, `body_only`, `dumbbell`, `foam_roll`, `ez_curl_bar`, `kettlebells`, `exercise_ball`, `medicine_ball`                                                |
| `muscles`      | enum-array             | yes      | Union of `primaryMuscles` and `secondaryMuscles` from GitHub. Values: `lats`, `neck`, `traps`, `chest`, `biceps`, `calves`, `glutes`, `triceps`, `forearms`, `abductors`, `adductors`, `lower_back`, `shoulders`, `abdominals`, `hamstrings`, `middle_back`, `quadriceps` |
| `instructions` | array of string        | yes      | Directly from GitHub                                                                                                                                                                                                                                                      |
| `images`       | array of `ImageSchema` | yes      | All GitHub image URLs as `{ kind: "remote", url }` entries. URLs constructed as `${IMAGES_PREFIX_URL}/${relativePath}`                                                                                                                                                    |

The entity's top-level `image` field stores the first image from `properties.images` (or `null` if none).

### GitHub Category → Lot Mapping

| GitHub `category`                                                | `lot` value             |
| ---------------------------------------------------------------- | ----------------------- |
| `cardio`                                                         | `distance_and_duration` |
| `stretching`, `plyometrics`                                      | `duration`              |
| `strongman`, `olympic weightlifting`, `strength`, `powerlifting` | `reps_and_weight`       |

Exercises with an unrecognized category are skipped with a warning log.

### Exercise External ID

The exercise `externalId` is the raw exercise name as returned by GitHub (e.g., `"Barbell Bench Press"`), matching V1 behavior. This is used for deduplication on re-seed.

### Database Schema Change

A new partial unique index is added to the `entity` table:

- Columns: `(external_id, entity_schema_id)`
- Condition: `user_id IS NULL AND sandbox_script_id IS NULL`

This enables proper `INSERT ... ON CONFLICT DO UPDATE` upserts for exercise entities, which have no sandbox script. The existing `entity_global_external_id_unique` index includes `sandbox_script_id` in its indexed columns; because PostgreSQL treats NULLs as distinct in unique indexes by default, it cannot deduplicate rows where `sandbox_script_id` is NULL.

The ideal fix would be to add `NULLS NOT DISTINCT` to the existing index, but Drizzle ORM does not yet support `NULLS NOT DISTINCT` on `uniqueIndex()`. A TODO comment on the new index in `tables.ts` points to the upstream issue and explains that the index should be collapsed back into the existing one once Drizzle adds support: https://github.com/drizzle-team/drizzle-orm/issues/3892

### Seeding Architecture

- A new dedicated **`fitness` BullMQ queue** is added alongside the existing `media`, `events`, and `sandbox` queues.
- A new **`fitness` module** owns the seeding job (`exercise-seed`) and its worker, following the existing module pattern (`jobs.ts`, `worker.ts`, `index.ts`).
- The worker:
  1. Fetches the GitHub exercises JSON from `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json`.
  2. Looks up the builtin `exercise` entity schema ID.
  3. For each exercise, maps GitHub fields to the exercise properties schema.
  4. Upserts each exercise entity using `INSERT ... ON CONFLICT (...) WHERE ... DO UPDATE SET ...`, targeting the new partial unique index.
  5. Skips and logs a warning for any exercise that fails mapping (e.g., unrecognized category). Continues with the rest.
- The seed job is dispatched **once on startup** (in `startServer`, after workers are initialized) with a deterministic `jobId` of `"exercise-seed-initial"`. It only dispatches if the count of entities under the exercise schema is zero (skip on subsequent restarts).

### Registration: Tracker + Saved View

- The exercise entity schema entry in `authenticationBuiltinEntitySchemas` includes `trackerSlug: "fitness"`, so it is automatically linked to each user's Fitness tracker at registration via the existing `buildAuthenticationTrackerEntitySchemaLinks` mechanism.
- An "All Exercises" entry is added to `authenticationBuiltinSavedViews`, pointing to `entitySchemaSlug: "exercise"` and `trackerSlug: "fitness"`. This creates a per-user saved view on registration, making exercises browsable from the Fitness tracker sidebar immediately.

### Listing

Exercises are listed via the existing query engine (`POST /query-engine`) using `entitySchemaSlugs: ["exercise"]`. No dedicated `/exercises` endpoint is added.

## Testing Decisions

No automated tests are written for this feature. The seeding logic (mapping, normalization, upsert) is straightforward imperative code. Integration correctness is verified by running the app and confirming exercises are seeded.

## Out of Scope

- Workout logging, workout tracking, or any user interaction with exercises beyond listing and browsing.
- Custom exercise creation by users.
- Per-user exercise history, workout sessions, or personal bests.
- Exercise merging (V1 feature).
- Any frontend changes (the query engine API is already accessible).
- Re-seeding exercises on subsequent restarts (only seeds once).

## Further Notes

- **V1 parity**: V1 stored exercises in a dedicated `exercise` table with strongly typed columns. V2 stores them as JSONB properties inside the generic `entity` table. The query engine already supports JSONB filtering, so all V1 filter dimensions (muscles, equipment, level, force, mechanic, lot) are supported without schema changes.
- **GitHub data source**: `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json`. Image URLs are constructed as `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/{relativePath}`.
- **Existing users**: Out of scope. Only new users (registered after this feature is deployed) get the tracker-entity-schema link and "All Exercises" saved view created at signup. Existing users are not backfilled.

---

## Tasks

**Overall Progress:** 3 of 3 tasks completed

**Current Task:** All tasks complete.

### Task List

| #   | Task                                                             | Type | Status |
| --- | ---------------------------------------------------------------- | ---- | ------ |
| 01  | [Exercise Schema Foundation](./01-exercise-schema-foundation.md) | AFK  | done   |
| 02  | [Exercise Seeding](./02-exercise-seeding.md)                     | AFK  | done   |
| 03  | [Codebase Cleanup](./03-codebase-cleanup.md)                     | AFK  | done   |
