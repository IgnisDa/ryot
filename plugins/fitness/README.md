# Fitness Plugin

Generic package, manifest, and sandbox authoring rules belong to the
[Plugin Kit](../../packages/plugin-kit/README.md).

Fitness list and detail recipes live in `shared/query-recipes.ts`; the user-library recipe and
library-link predicate live in `shared/library-recipes.ts`. Shared entity selections in
`shared/entity-selections.ts` and their table-neutral property expressions are reused by the archived
workout presentation query. List recipes share input types with pagination derived from RyotQL query
inputs. The shared sources use the neutral Plugin Kit imports so both plugin compilers can resolve
them.

Exercise targets and equipment are separate entity taxonomies in `shared/taxonomy-recipes.ts`.
Exercise targets use `exercise-targets` relationships with an optional role; equipment uses
`exercise-uses-equipment`. Shared standard entities and private user-owned entities are visible
through RyotQL scoping, and `userId` identifies their origin. Omitting a target role is valid.
Authenticated entity and relationship create operations support manual additions; provider taxonomy
migration remains pending.

## Imports

Fitness imports append history and cannot be reversed. A separate import can duplicate existing
activity. Run reports count workouts or measurements in their source-owned units, not internal
chunks. Activities describe source reading, exercise resolution, and writing separately from actual
created, updated, unchanged, skipped, or unsuccessful outcomes. Active recovery retains inputs and
execution pins until terminal cleanup; cancelling keeps committed results.

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

`policy.workout-context` requires workout-set events to reference an exercise with a kind and a
workout with a start time. It sets `occurredAt` from `confirmedAt`, or from the workout start when
confirmation is absent. `policy.workout-set` converts imperial weight and distance to metric,
normalizes measurements and derived statistics, and removes supplied personal-best badges outside
trusted record-worker updates. `fitness.workout-records` batches workout-set changes by exercise and
dispatches `script.workout-record-step`. The worker reads the current user-scoped event stream,
normalizes event times, and recomputes derived statistics and personal-best badges in bounded pages.
It does not replay historical automation triggers. Entity update policies receive a sorted, distinct
summary of dependent event schemas and reference roles. The context policy blocks removing or
invalidating exercise kind when workout-set events reference the exercise, and workout start time
when workout-set events reference the workout. It permits these changes when no matching events
exist, including for global entities.
