# Fitness Plugin

Generic package, manifest, and sandbox authoring rules belong to the
[Plugin Kit](../../packages/plugin-kit/README.md).

`shared/plugin-identity.ts` holds the `ryot/fitness` package ID.

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

## Storage Units

Workout and template set measurements use kg, km, and seconds. Workout `caloriesBurnt` uses kcal;
displaying kJ multiplies by 4.184. Display preferences never change stored units.

## Workout Preferences And Duration

The exact user's Fitness installation owns the flat `userSettingsSchema` preferences: `unitSystem`
(`metric`), `normalRestTime` (60 seconds), `warmUpRestTime`, `dropRestTime`, and `failureRestTime`
(0 seconds), `muteSounds` and `promptForRestTimer` (false), `startTimerForDurationExercises` (true),
and `energyUnit` (`kcal`, with `kJ` also supported). Defaults make an empty record valid; explicit null
choices are invalid. Reset removes stored choices. These are not kernel preferences or plugin config.

The user's `in-fitness-library` relationship owns optional per-exercise rest overrides with the same
four names and `defaultDurationUnit` (`seconds` or `minutes`). These fields have no defaults. Missing
or null overrides inherit; removing a field restores inheritance. Shared provider exercise entities
never own these choices. Membership-only writes merge properties and preserve existing overrides.

Rest precedence is explicit set choice, including template-set `restTime`, then the exercise override
for its set type, then the global setting, then the declared default. Zero explicitly disables rest;
it is not a missing value. Duration display precedence is occurrence choice, exercise override, then
minutes. Weight/distance and energy display use an occurrence choice, then the global setting, then
metric/kcal. Sound, rest prompting, and countdown behavior use a local choice when present, otherwise
the global setting and its default. Preference changes do not alter saved measurements or rest times.

Optional workout `activeDuration` records nonnegative whole seconds including ordinary rests but
excluding explicit pauses. `startedAt` and `endedAt` retain actual timestamps. Missing/null active
duration means unknown, not zero; elapsed time from timestamps is a separate measure. New logged
sessions sum unpaused draft intervals and truncate the total once. Historical edits preserve recorded
active duration unless explicitly corrected or cleared; repeats and templates do not copy it into a
new session. Running timers, pause intervals, unconfirmed sets, and collapse state belong to local
drafts, not saved properties. Current workout detail presentation uses elapsed time and metric values.

## Measurements

A `measurement-metric` entity is one user-owned metric: its name is the display label, `key` is the
stable identifier, and `unit` is optional. Each recorded value is a `measurement-reading` event on
its metric with a required `value`, an optional `comment`, and `occurredAt` as the reading time.
Values recorded together share `occurredAt`, and the comment is repeated on each of their events.
`measurementReadingListRecipe` in `shared/query-recipes.ts` lists a user's readings with their
metric key, name, and unit, newest first, optionally from a start time.

The All Measurements saved view renders the `measurements` client page (`client/measurements/`),
which takes only the view's name and icon from the page context and has no data sources or
settings. It queries three recipes from `shared/`:

- `measurementSummaryRecipe` pages metrics 100 at a time with each one's key, latest value and time,
  first reading time, and reading count since the range start. The page follows every cursor.
- `measurementSeriesRecipe` returns one `timeSeries` average of the reading value per metric, with a
  paired `count` series because empty buckets are zero filled. The page batches
  `MEASUREMENT_SERIES_BATCH_SIZE` metrics per document to stay within the ten-query limit, buckets by
  day up to 1Y and by week for All, and clamps All to 900 weekly buckets.
- `measurementReadingListRecipe` pages the log 100 readings at a time; the page groups readings that
  share `occurredAt` into one row and groups rows by month. Show more preserves loaded rows while
  fetching; a failed later page shows an error and retry. Missing or repeated cursors fail loading.

Pinned metrics are the page's tiles and log columns, ordered by pin time; a dashed card asks for more
pins until three are pinned. The chart opens on the first pinned metric. Trend lines and sparklines
are a trailing rolling average of the bucket averages, over 7 points when there are more than 40 and
3 otherwise.

A pin is a user `measurement-metric-pinned` relationship from the metric to the user's Fitness
Library; `measurementSummaryRecipe` returns its creation time as `pinnedAt`. The star on each metric
row calls `measurement-metric-pin`, which verifies the metric, treats a request matching the current
state as a no-op, and rejects a fourth pin. The limit is checked before writing, so concurrent
requests can exceed it. `measurement-metric-create` pins the new metric when the caller had fewer
than two metrics; imports do not pin.

`client/measurements/reading-composer.tsx` exports `MeasurementComposer`, a page-independent form for
one timestamp, per-metric values, and an optional comment, so the workout logger can embed it.
Empty value fields are skipped, at least one finite value (zero included) is required, and an
unchanged timestamp keeps the original seconds. Input stays after validation or save failures; the
dialogs close only on success, and the mutation completion refreshes the page queries.
`client/measurements/mutations.ts` owns the log, update, and delete mutations.

Log measurement prefills the pinned metrics (or the first metric when there are none) and offers the
rest through Add metric value. `measurement-reading-log` checks every metric ID is a
`measurement-metric` visible to the caller, then writes all readings in one `createEvents` call.
The client SDK's retained submission keeps one ID, submission timestamp, and immutable input across
attempts. `createEvents` uses that identity with existing mutation receipts to replay committed
readings and retry unfinished ones without duplication. Conflicting reuse is rejected. Partial or
skipped writes return an incomplete result; the composer retains its input and offers Retry save.
Cancelling closes the form but does not undo committed readings. Page refresh advances the chart's
time window without unmounting a retained log form.

`shared/measurement-properties.ts` builds metric and reading properties for both interactive writes
and imports. OpenScale retains ownership of source parsing, units, dates, identities, and attribution.

Edit on a log row opens the composer with the row's loaded values and sends its reading IDs to
`measurement-reading-update`. The operation verifies the readings and any newly added metrics, then
patches kept readings' time, value, and comment (removing a cleared comment), creates readings for
added metrics, and deletes readings whose value was cleared. These are separate `updateEvents`,
`createEvents`, and `deleteEvents` calls in that order, so a failure can leave an edit partly applied.

Delete on a log row confirms, then sends every reading ID in that row to
`measurement-reading-delete`. Update and delete reject the whole request unless every reading ID is
a `measurement-reading` event on a `measurement-metric` entity visible to the caller; delete removes
them in one `deleteEvents` call. A row split across a page boundary edits or deletes
only its loaded readings.

Add metric opens a name and optional unit form. `measurement-metric-create` creates only a user-owned
metric through the sandbox `createUserEntity` capability. Shared rules in
`shared/measurement-metrics.ts` generate a lowercase ASCII key using the OpenScale normalization and
choose canonical units for known keys; incompatible units and names producing an empty key are
rejected. Unknown keys allow an optional custom unit. The form guards duplicate keys against all
loaded metrics; concurrent or direct API writes are not subject to an atomic uniqueness constraint.
Import reuse still requires both a matching normalized name and key.

Metric cards and rows show the latest reading, such as `73.6 kg · 8 Oct`, taken from the metric's
newest `measurement-reading` event.

## Imports

Fitness imports append history and cannot be reversed. A separate import can duplicate existing
activity. Run reports count workouts or measurements in their source-owned units, not internal
chunks. Activities describe source reading, exercise resolution, and writing separately from actual
created, updated, unchanged, skipped, or unsuccessful outcomes. Active recovery retains inputs and
execution pins until terminal cleanup; cancelling keeps committed results.

Strong imports use the source-reported workout duration as `activeDuration`, truncated once to whole
seconds. Excluding pauses is an assumption about that source's timer, not verified pause evidence.
Its end timestamp remains start plus source duration. Hevy imports preserve start/end timestamps and
leave active duration unknown because the export supplies no session-duration or pause evidence.

An OpenScale row becomes one write item: each non-empty numeric column finds or creates the user's
`measurement-metric` matched by column label and normalized `key`, and gets one
`measurement-reading` event at the row time carrying the row comment. Metrics created by the import
take a unit for the known OpenScale keys (`weight`, `lbm`, `bone` in kg; `bmi` in kg/m²; `fat`, `water`,
`muscle` in %; `waist`, `hip` in cm). Each row counts as one measurement, reported on its first reading. A row
with a valid date and no numeric value is an unsuccessful measurement.

## Workout Editor Contracts

`workout-editor-context` returns the caller's defaulted installation settings and trusted Pro
availability. `exercise-override-update` changes only the caller's library membership; removing a
field restores inheritance. Global settings remain kernel-owned.

`workout-editor-save` creates and updates workouts and templates. Update inputs retain the source
baseline and source exercise positions, so reordering does not change occurrence or event identity.
`encodeWorkoutEditorDraft` stores one losslessly compressed JSON string; its decoder and the baseline
decoder each bound expansion to 128 KiB. Encoded drafts and complete save inputs must still fit their
separate 64 KiB budgets. Save data stays uncompressed. A submission's data, baseline, ID, and timestamp
must remain fixed across retries. Each service write uses mutation receipts; no outer transaction
rolls back earlier writes on a later failure.

The draft's optional `submission` retains the complete save input. Save-input construction reuses it
unchanged until completion, including after settings or display context changes.

The workout is written before its sets and relationships. A new save writes a `workout-completed`
event only after its required writes succeed. Its after hook emits `workout.created`; personal-best
recalculation remains independent. Templates store planned sets on the entity and have no execution
events. Typed results distinguish completion, incomplete saves, conflicts, validation, and Pro gates.
Rejections marked `canEdit` occurred before writes in that invocation. The editor releases a
submission only when that rejection answers its first attempt in the current session. Retries and
recovered submissions may already have committed writes and remain fixed until completion.

Ordinary historical edits preserve workout and set times. `workout-time-correction` changes only
workout start/end, preserving active duration unless the input explicitly sets or clears it. Free
historical edits retain existing protected notes and media; removing those values is allowed, while
adding or changing them requires Pro. Template changes and replacement remain Pro-gated.

`shared/workout-editor-recipes.ts` provides complete entity properties, cursor-paged top-level sets,
selected exercises, membership overrides, and source links. Picker/taxonomy and history/Previous
recipes are separate paged reads, not Pro data permissions. `shared/workout-editor-source.ts`
hydrates historical/template drafts and clones sources, retaining the baseline when an unavailable
exercise or malformed record blocks loading. These contracts do not register editor screens.

`client/workout-editor/screen.tsx` exports the shared editor with a semantic resume target, an optional
initial draft, and a saved-entity callback. Retained screens share one controller per client runtime
for immediate input, ordered device persistence, and active-screen wake demand. Live completion and
recovery share set progression; prompted rest retains its target in
the draft. Historical and template modes do not start execution clocks. Finish reviews included and
omitted sets before freezing the submission. The editor component does not register production routes.

The Fitness Library picker owns ordered selection, multi-value filters, usage sorting, and bounded
device-local presets. Provider search returns generic added entity IDs; Fitness reloads them and
checks eligibility before selecting them. Neither picker cancellation nor workout cancellation
removes an exercise already added to the library.

## Automations

`fitness.ensure-fitness-library-membership` is a required, user-scoped after hook on exercise
creation and exercise provider-entity-import completion; it upserts `in-fitness-library` to the
user's `fitness-library`. Workout imports write the same relationship for each imported exercise in
their write items. The All Exercises saved view lists only exercises with that relationship.

`fitness.workout-created` is an async after hook for API-created workout completion events. The manifest's
causation filter excludes imports and other sources. Its script reads the immutable event snapshot
from `automation.payload` and emits `workout.created`.

`fitness.notification` is the signal's stable notification hook. It reads the inline signal payload
and formats the plugin-owned message. Notification delivery has one attempt and no automatic retry
of uncertain external outcomes. Neither script queries execution records through RyotQL.

Workouts require a valid `startedAt`, which the kernel validates on every write. `policy.workout-context`
requires workout-set events to reference a workout and sets `occurredAt` from `confirmedAt` when
present. Without confirmation it preserves the event time; writers supply workout start for a new
untimed historical set.
`policy.workout-set` records the exercise kind on each set: a supplied or stored `exerciseKind` is
kept, and an absent one is taken from the exercise. Sets accept only canonical metric measurements
(kg, km, seconds) and reject undeclared properties; writers convert before writing. The policy derives
statistics from the set's kind and removes supplied personal-best badges outside trusted record-worker
updates. Fitness policies target only workout-set
events, so exercise and workout updates, including provider refreshes, never run them. `fitness.workout-records` batches
workout-set changes by exercise and dispatches `script.workout-record-step`; the worker reads the
current user-scoped event stream, normalizes confirmed event times, and recomputes derived statistics and
personal-best badges in bounded pages, tracking bests separately for each recorded kind. It does not
replay historical automation triggers. `fitness.workout-context-records` repairs the streams of a
workout's exercises when its start time changes.
