# Exercise Schema Foundation

**Parent Plan:** [Exercises Support in Ryot V2](./README.md)

**Type:** AFK

**Status:** done

## What to build

Lay the data foundation for exercises end-to-end so that a newly registered user has a working (but empty) "All Exercises" view under the Fitness tracker.

Concretely:

- Add the `exercisePropertiesJsonSchema` (AppSchema definition covering all fields from the PRD: `lot`, `level`, `source`, `force`, `mechanic`, `equipment`, `muscles`, `instructions`, `images`) to a new `src/lib/fitness/exercise.ts` file.
- Add a new partial unique index to the `entity` table in `tables.ts` on `(external_id, entity_schema_id)` where `user_id IS NULL AND sandbox_script_id IS NULL`. Include a TODO comment explaining that this exists as a workaround because Drizzle does not yet support `NULLS NOT DISTINCT` on `uniqueIndex()`, and linking to https://github.com/drizzle-team/drizzle-orm/issues/3892.
- Generate the Drizzle migration (`bun run db:generate`).
- Add the `exercise` entity schema entry to `authenticationBuiltinEntitySchemas()` in the authentication bootstrap manifests, with `trackerSlug: "fitness"`, using the properties schema above.
- Add an "All Exercises" entry to `authenticationBuiltinSavedViews()` pointing to `entitySchemaSlug: "exercise"` and `trackerSlug: "fitness"`.

See the **Exercise Entity Schema**, **Exercise Properties Schema**, **Database Schema Change**, and **Registration: Tracker + Saved View** sections of the PRD for full field definitions and enum values.

## Acceptance criteria

- [x] A new migration is generated and applies cleanly.
- [x] The new partial unique index exists on the `entity` table after migration.
- [x] A newly registered user has the Fitness tracker in their tracker list.
- [x] That user has an "All Exercises" saved view under the Fitness tracker.
- [x] The exercise entity schema is visible via `GET /entity-schemas` for the user.
- [x] `bun run typecheck` passes with no errors.

## User stories addressed

- User story 1

