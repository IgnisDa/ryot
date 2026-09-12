# Fitness Plugin

Generic package, manifest, and sandbox authoring rules belong to the
[Plugin Kit](../../packages/plugin-kit/README.md).

Fitness list and detail recipes live in `shared/query-recipes.ts`; the user-library recipe and
library-link predicate live in `shared/library-recipes.ts`. Shared entity selections in
`shared/entity-selections.ts` and their table-neutral property expressions are reused by the archived
workout presentation query. List recipes share input types with pagination derived from RyotQL query
inputs. The shared sources use the neutral Plugin Kit imports so both plugin compilers can resolve
them.

## Automations

`fitness.ensure-fitness-library-membership` is a required, user-scoped after hook on exercise
creation and exercise provider-entity-import completion; it upserts `in-fitness-library` to the
user's `fitness-library`. Workout imports write the same relationship for each imported exercise in
their write items. The All Exercises saved view lists only exercises with that relationship.

`fitness.workout-created` is an async after hook for API-created workouts. The manifest's
causation filter excludes imports and other sources. Its script reads the immutable entity snapshot
from `automation.payload` and emits `workout.created`.

`fitness.notification` is the signal's stable notification hook. It reads the inline signal payload
and formats the plugin-owned message. Notification delivery has one attempt and no automatic retry
of uncertain external outcomes. Neither script queries execution records through RyotQL.
