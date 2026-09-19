# Fitness Plugin

Generic package, manifest, and sandbox authoring rules belong to the
[Plugin Kit](../../packages/plugin-kit/README.md).

Fitness list and detail recipes live in `shared/query-recipes.ts`; the user-library recipe and
library-link predicate live in `shared/library-recipes.ts`. Shared entity selections in
`shared/entity-selections.ts` and their table-neutral property expressions are reused by the archived
workout presentation query. List recipes share input types with pagination derived from RyotQL query
inputs. The shared sources use the neutral Plugin Kit imports so both plugin compilers can resolve
them.

The workout detail page reads one `workoutDetailsRecipe` document from
`shared/workout-details-recipes.ts`: the workout, its repeated-from and template links, and each
exercise with its sets, targets, equipment, and the sets of its latest earlier session, chosen by
workout start through a correlated `first`. Each exercise returns at most 100 sets per session.

The exercise detail page reads one `exerciseDetailsRecipe` document from
`shared/exercise-details-recipes.ts`: the exercise with its targets and equipment, ungrouped totals
(including the best weight for at least 1, 5, 8, 12, and 30 reps), monthly buckets in the caller's time
zone, the most frequent workout, the five latest sessions with their sets, set and workout notes, and
the exercise's `review` notes. Personal-best rows and notes are bounded to the newest 100 rows (set and
workout notes to 20); personal-best rows come newest first and the client keeps the newest set per badge
type.

The exercise detail page (`client/exercise/screen.tsx`) renders that document for an `exercise` entity:
overview, kind-aware history with a monthly chart and personal bests, recent sessions, instructions,
private notes, and the read-only set and workout notes. Notes are written through the note operations
using the schemas in `shared/exercise-note-operations.ts`, which client sources can import. Edit shows
only for exercises with an owner.

Exercise targets and equipment are separate entity taxonomies in `shared/taxonomy-recipes.ts`.
Exercise targets use `exercise-targets` relationships with an optional role; equipment uses
`exercise-uses-equipment`. Shared standard entities and private user-owned entities are visible
through RyotQL scoping, and `userId` identifies their origin. Omitting a target role is valid.
Authenticated entity and relationship create operations support manual additions; provider taxonomy
migration remains pending.

Private exercise notes are `review` events on `exercise` entities, written only through the
`exercise-note-create`, `exercise-note-update`, and `exercise-note-delete` operations. Create
requires a visible entity whose schema is `exercise`. Update and delete require the event to be a
`review` joined to an `exercise` entity, because the `review` slug is shared with media and
collection schemas and the operation's RyotQL sees every event of the user. Updates patch only
`text` and `rating`. Note text is trimmed and limited to 2000 characters at the operation input;
the stored schema stays unbounded for migrated notes.

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

Workouts require a valid `startedAt`, which the kernel validates on every write. `policy.workout-context`
requires workout-set events to reference a workout and sets `occurredAt` from `confirmedAt`, or from
the workout start when confirmation is absent.
`policy.workout-set` records the exercise kind on each set: a supplied or stored `exerciseKind` is
kept, and an absent one is taken from the exercise. Sets accept only canonical metric measurements
(kg, km, seconds) and reject undeclared properties; writers convert before writing. The policy derives
statistics from the set's kind and removes supplied personal-best badges outside trusted record-worker
updates. Fitness policies target only workout-set
events, so exercise and workout updates, including provider refreshes, never run them. `fitness.workout-records` batches
workout-set changes by exercise and dispatches `script.workout-record-step`; the worker reads the
current user-scoped event stream, normalizes event times, and recomputes derived statistics and
personal-best badges in bounded pages, tracking bests separately for each recorded kind. It does not
replay historical automation triggers. `fitness.workout-context-records` repairs the streams of a
workout's exercises when its start time changes.
