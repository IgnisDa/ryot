# Exercise Seeding

**Parent Plan:** [Exercises Support in Ryot V2](./README.md)

**Type:** AFK

**Status:** done

## What to build

Implement the BullMQ-based seeding pipeline that populates all ~900 exercises from the GitHub dataset as global entities on first startup.

Concretely:

- Create a new `fitness` module at `src/modules/fitness/` with `jobs.ts`, `worker.ts`, and `index.ts`, following the existing module pattern (see the `media` module as prior art).
- `jobs.ts` defines the `exercise-seed` job name constant and its (empty) payload schema.
- `worker.ts` implements the seed logic:
  1. Fetch `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json`.
  2. Look up the builtin `exercise` entity schema ID via `getBuiltinEntitySchemaBySlug`.
  3. For each exercise, map GitHub fields to the exercise properties schema (category → lot, equipment normalization, image URL construction, muscles union). Skip and log a warning for any exercise with an unrecognized category.
  4. Upsert each exercise entity using `INSERT ... ON CONFLICT (...) WHERE ... DO UPDATE SET ...` targeting the partial unique index added in task 01.
  5. Set `entity.image` to the first image (or `null`) and store all images in `properties.images`.
- Add a dedicated `fitness` BullMQ queue to `src/lib/queue/queues.ts`, initialize/shutdown it in `src/lib/queue/index.ts`, and register the fitness worker in `src/lib/queue/workers.ts`.
- In `startServer` (`src/app/runtime.ts`), after workers are initialized, check if the entity count under the exercise schema is zero. If so, dispatch the `exercise-seed` job with the deterministic `jobId` `"exercise-seed-initial"`.

See the **Seeding Architecture**, **GitHub Category → Lot Mapping**, **Exercise External ID**, and **Exercise Properties Schema** sections of the PRD for all mapping details.

## Acceptance criteria

- [x] Starting the app from a clean DB triggers the seed job exactly once.
- [x] After seeding, ~900 exercise entities exist in the `entity` table with `user_id = NULL`.
- [x] Each entity has a correctly populated `name`, `image` (first GitHub image or null), and `properties` (lot, level, source, muscles, instructions, images).
- [x] Exercises are queryable via `POST /query-engine` with `entitySchemaSlugs: ["exercise"]`.
- [x] Filtering by `muscles`, `equipment`, `level`, `force`, `mechanic`, and `lot` via the query engine returns correct results.
- [x] Restarting the app does not trigger a second seed run and does not create duplicate entities.
- [x] An exercise with an unrecognized GitHub category is skipped with a warning; remaining exercises are still seeded.
- [x] `bun run typecheck` passes with no errors.

## User stories addressed

- User story 2
- User story 3
- User story 4
- User story 5
- User story 6
- User story 7
- User story 8
- User story 9
- User story 10
- User story 11
- User story 12
- User story 13

