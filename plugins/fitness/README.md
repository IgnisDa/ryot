# Fitness Plugin

`shared/plugin-identity.ts` declares `ryot/fitness`. Generic authoring rules belong to the
[Plugin Kit](../../packages/plugin-kit/README.md). Domain recipes and operation schemas live in
`shared/` so client and sandbox code use the same contracts through neutral imports.

Workout details load metadata plus cursor-paged exercises, sets, and previous-session sets; totals
use the complete loaded set collection. Exercise details combine targets/equipment, kind-aware
history, personal bests, recent sessions, instructions, private reviews, and read-only workout/set
notes. Attachments use managed URLs with renewal, image preview, and video playback.

## Exercises And Writes

Custom exercises use the shared entity editor. The manifest declares editors for `exercise` (with
`exercise-targets` and `exercise-uses-equipment`), `exercise-target`, and `exercise-equipment`; the
kernel editor save permits only those declared relationships and atomically saves the entity and
its outgoing links. `kind` is required and immutable. The creation hook adds library membership. Duplication copies visible properties and taxonomy links into a new custom
exercise. Standard and private taxonomies are visible through normal RyotQL scoping; target roles
are optional. Adding a target or equipment opens the kernel entity picker for that schema: visible
taxonomies, Fitness Catalog results not yet imported (importing one selects it), and inline creation
of a private target or equipment through its editor, where a target's `kind` is required.

Provider exercises are read-only in ordinary user editors, including private-provider exercises.
Provider refreshes own their canonical name and properties, including the source-derived `kind`.
Existing workout sets retain their recorded `exerciseKind`; a provider correction does not rewrite
historical set meaning or measurements.

### Recorded taxonomy and canonical metrics

Each performed exercise occurrence has one `workout-exercise` event owned by its exercise,
with `sessionEntityId` pointing to the workout. Sets join it by session, exercise and
`exerciseOrder`. Templates do not produce these events. The editor commits occurrence evidence
with sets, preserves it across historical edits/reorder and removes it when the occurrence is
removed. Strong/Hevy import intents include occurrence events too.

The strict properties are:

```ts
{
  exerciseOrder: number; // nonnegative integer
  exerciseKind: ExerciseKind;
  targets: { entityId: string; role: "primary" | "secondary" | "stabilizer" | null }[];
  equipment: string[];
}
```

Each array has at most 100 items. `policy.workout-exercise` captures applicable effective
taxonomy links on creation and rejects overflow rather than truncating; it allows updates, whose
immutability the kernel event group enforces. Replacing an occurrence's exercise deletes its anchor
and creates a new one so the replacement's taxonomy is captured; position-only moves update it. All target/equipment IDs are declared `entity-id` references, so ordinary backup
dependency discovery, restore remapping, user-data rewriting and provider retention see them.
The event owner participates in exercise merge; the session reference participates in workout
deletion. There is no per-set copy of the taxonomy.

V1 conversion writes this schema directly, once per performed exercise position, using the
exercise's taxonomy at export time as the frozen assignments.
An occurrence's `occurredAt` is always its workout's start, so period queries can bound
occurrences and their sets through the event time index; this is not timed-set evidence.

`fitness-metrics.ts`, `workout-list-recipes.ts` and `analytics-recipes.ts` define shared metrics.
Metric definitions carry either a fixed unit or a converted measure; `displayMeasure` in
`workout-units.ts` is the only storage-to-display unit converter.
Analytics totals expose active-duration and energy coverage, entries separately from readings,
and personal-best awards separately from awarded sets. Missing active duration remains null;
planned rest and set duration are separate quantities. Weight volume uses the existing kind-aware
projection in kg × repetitions. Award and volume totals sum the projections that are current.
Historical rankings and performed-work muscle displays read retained occurrence evidence, never
current exercise links. Target weights are primary/untyped 1, secondary 0.5 and stabilizer 0.
Rankings expose sets, exercise occurrences and distinct workouts separately. Each is one grouped
aggregate over the period's occurrences, unnesting recorded targets or equipment, ordered by weighted
sets with a grouped cursor; taxonomy without performed sets in the period is not listed. Set and
occurrence periods and buckets read the occurrence `occurredAt`; workout counts, durations, hours
and drill-downs read the workout `startedAt` property. All-time totals omit range bounds. Coverage
reports sets whose taxonomy came from a legacy export.

Analytics recipe inputs are `{ reference, reporting }`, where `reporting` is the
`ResolvedReportingSelection` the client query already computed; historical rankings add `kind`
(`targets`, `equipment`, or `exercises`) and optional `after`. Reporting boundaries resolve from the
supplied clock and the account reporting timezone at query execution. Home, workout summaries, and
measurement ranges use the same resolver. Muscle totals key by entity ID, so equally named targets
remain separate.

### Analytics query API

`shared/analytics-recipes.ts` exports the production recipes below. Each accepts the resolved
reporting selection and plugin `reference`. `client/analytics/queries.ts` builds them with the client
SDK's reported, compared, paged and consistency query constructors, which take the stable
`ReportingSelection` and reporting `timeZone` as inputs and resolve them against `schedule.now()`
inside each query execution, so moving timestamps do not become query cache keys. Inputs are the
section's props, so its exact `reference` is part of the cache key.

| Recipe                             | Additional input                   | Result                                                                           | Named queries |
| ---------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------- | ------------- |
| `fitnessAnalyticsTotalsRecipe`     | optional `filter`                  | Counts, entered measurements, derived metrics, missing-data and processing state | 4             |
| `fitnessAnalyticsTrendRecipe`      | `metric`, optional `filter`        | Sparse buckets with observations, known values and processing state              | 1             |
| `fitnessWorkoutStartsByHourRecipe` | optional `filter`                  | 24 reporting-timezone bins labeled **Workout starts**                            | 1             |
| `historicalFitnessRankingRecipe`   | `kind`, optional `filter`, `after` | 100-row cursor page of retained-taxonomy counts and weighted sets                | 1             |
| `fitnessAnalyticsWorkoutsRecipe`   | optional `filter`, `after`         | 100-row cursor page, newest workout start first                                  | 1             |
| `fitnessMeasurementTrendRecipe`    | `metricId`                         | Sparse average buckets with reading count and metric unit                        | 1             |
| `fitnessMeasurementReadingsRecipe` | `metricId`, optional `after`       | 100-row cursor page of readings, unit, occurrence time and entry ID              | 1             |

`filter` is `{ kind: "exercises" | "targets" | "equipment", id }`. It filters sets and their
workouts; measurement counts in the totals remain independent of workout filters. Trend metrics
are workouts, sets, volume, repetitions, distance, active duration, recorded calories, set duration,
planned rest and personal-best awards. Units come from `fitnessMetricDefinitions`.

Workout trends and hours use workout starts even when imported set timestamps are fallback values.
Measurement trends use reading times and keep metrics separate. Missing buckets remain absent;
recorded zero remains zero. Trend and summary queries run the previous period as a second recipe
execution with the previous period as `current`, inside the same client query, and skip it when the selection
has no previous period. Trend queries are capped at `REPORTING_BUCKET_LIMIT`. The client lays sparse
buckets onto the shared `calendarBuckets` grid; `resolveReportingSelection` keeps every grouping
within the shared bucket limit, and all-time groups by year. Paged results use `useReportedPages`,
which pins the first page's resolved period, and drills reuse each result's pinned selection.

Processing state is one `"ready" | "pending" | "failed"` value from the shared RyotQL recipe helpers.
Analytics totals and derived trend buckets count the projection status of the sets they already
aggregate, so the state describes that period or bucket; workout cards and set rows read it from
that workout's sets. Values that exist are always shown; pending or failed state adds a note and
never hides them. Screens show one note from the processing poll, which reads the user's
`workout-set` event streams, narrowed to one workout or exercise on its screen.
Set queries inner join each set's occurrence by user, plugin, session, exercise, order and recorded
kind; the kernel's unique anchor positions keep that join one-to-one, and taxonomy filters reuse the
joined occurrence.

The editor fences evidence reads with the workout event-scope revision and rejects evidence that
disagrees with the original set owner/kind. The manifest's
session-scoped `eventGroup` keys anchors by `exerciseOrder`; sets must match the anchor's exercise,
order and recorded kind. The kernel validates final state in the commit transaction, including
unique positions, nonempty anchors, immutable session/taxonomy/kind and retained set-to-anchor
identity. Atomic editor commands can swap positions, replace exercises and remove the last set with
its anchor. Imports use the existing generic atomic event adapter and omit empty occurrences.
Standalone set writes require a matching anchor; adding a new occurrence or deleting its last set
requires an atomic command that includes the anchor. Before policies capture facts but do not enforce
cross-command cardinality. See [atomic event groups](../../kernel/backend/src/modules/events/README.md#atomic-event-groups).

`exercise-merge` requires distinct same-kind entities and a custom source. It detaches source
membership/taxonomy links, moves events/notes/collection membership through `mergeUserEntityData`,
then replaces template references. These steps are not atomic: retry-to-complete works after partial
detachment. The client blocks merging an exercise used by the active workout/template draft.

Exercise note operations require a visible exercise and a `review` event on that schema, not merely
the shared review slug. Updates patch only text/rating. Input text is trimmed/bounded, while stored
text remains unbounded for migrated notes. `workout-delete` removes the workout, events, and
relationships, queues surviving exercise record recalculation, and leaves exercises/templates and
separately logged measurements intact. `workout-template-delete` removes the template and its
relationships, leaving workouts started from it intact. Collection additions preserve existing
membership properties.

Mutating inputs carry the stable `SubmissionEnvelope` identity and timestamp. Writers send editable
set properties only; projection processors own derived statistics and personal-best badges. Retried writes keep
their complete input, timestamp, and identity unchanged.

## Storage Units

Set measurements use kg, km, and seconds; workout energy uses kcal. kJ display multiplies by 4.184.
Display preferences never change stored units.

## Workout Preferences And Duration

Preferences belong to the exact user's Fitness installation, not kernel preferences or plugin
configuration. `userSettingsSchema` defines units, per-set-type rest defaults, sound/prompt/countdown
choices, and optional `weeklyWorkoutGoal`. Missing or null goal means unset. Other explicit null
choices are invalid; reset removes stored choices and restores schema defaults.

Optional exercise rest/duration overrides belong to the user's `in-fitness-library` relationship,
never a shared provider exercise. Missing/null overrides inherit; membership-only writes preserve
them. Rest precedence is explicit set/template choice, exercise override, then installation setting
and schema default. Zero disables rest. Duration display uses occurrence choice, exercise override,
then minutes; weight/distance/energy use occurrence choice, then installation/default units. Local
sound/prompt/countdown choices override installation defaults without changing saved values.

`activeDuration` is nonnegative whole seconds including ordinary rest but excluding explicit pauses.
Missing/null means unknown, not zero; timestamp elapsed duration is separate. New sessions sum
unpaused intervals and truncate once. Historical edits preserve recorded duration unless explicitly
corrected/cleared; repeats/templates do not copy it. Running timers, pauses, unconfirmed sets, and
collapse state remain draft-local. Session flow uses timestamps, not configured rest as elapsed rest.

## Measurements

Each user-owned `measurement-metric` has a name, stable key, and optional unit. Its
`measurement-reading` events carry value and occurrence time for analytics. Each submission or
import row creates a user-owned `measurement-entry` containing time and optional comment; its
readings reference it through `sessionEntityId`.
All Measurements uses only page-context name/icon and these
shared recipes:

| Recipe                           | Purpose                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `measurementSummaryRecipe`       | Cursor-paged metrics with latest value/time, first reading, range count, and pin time                                                 |
| `measurementSeriesRecipe`        | Timezone-aware grouped averages; absent buckets remain missing and recorded zero remains zero; metric batches respect the query limit |
| `measurementEntryListRecipe`     | Newest-first entry pages, with all child pages loaded before display and month grouping                                               |
| `measurementEntryReadingsRecipe` | Cursor-paged children of one entry, without a total-child limit                                                                       |
| `measurementPageReadingsRecipe`  | Cursor-paged children of every entry on a loaded page, loaded in one query                                                            |

Ranges through 1Y use daily buckets; All uses weekly buckets, coarsening to months or years for
long histories without dropping early readings. Buckets use the reporting timezone. Trend lines smooth bucket
averages. Loaded rows remain during pagination; malformed/repeated cursors fail rather than loop.
Pinned metrics define tiles and log columns, ordered by pin time. Pins are
`measurement-metric-pinned` relationships to the Fitness Library. Pin requests matching current state
are no-ops; the limit of three is checked before writing, not enforced atomically across concurrent
requests. Metric creation pins while the caller has fewer than two metrics; imports do not pin.

`MeasurementComposer` is shared by the page and live workout editor. It accepts one timestamp,
per-metric finite values (zero included), and an optional comment. Empty values are skipped; at least
one is required. An unchanged timestamp retains seconds. Forms retain input on validation failure
or a refused submission and close once the kernel accepts the write. Live readings save independently and survive workout discard;
historical/template editors do not offer logging.

Measurement and workout-time forms use the device's named timezone. Nonexistent local times are
rejected. Repeated times show both UTC offsets; edits within the original local date preserve its
offset when valid, while other ambiguous times require an occurrence choice. An explicit choice
overrides the original offset.

`measurement-reading-log` validates every metric's schema/visibility, creates an entry, and sends one
`createEvents` batch (at most 100 values). The log, edit, and delete forms hand their write to the
kernel's background submissions and close once it is accepted; the shell tray reports the outcome and
offers Retry, which replays the same input and idempotency key so mutation receipts replay the entry
and committed readings without duplication. A partial write reports `incomplete`. Cancelling never
rolls back committed readings. Exercise note create, edit, and delete use background submissions too.
Workout deletion stays a foreground write because the page navigates away only after it succeeds, and
workout time correction stays foreground because its conflict and invalid results must reach the
form.

Update/delete resolve the caller-owned entry by ID. Update loads all
children, validates event and metric schemas/visibility, patches kept readings, creates added values,
deletes cleared values, then updates entry time/comment. Event writes use batches of at most 100,
including imported entries larger than 100 values. These are separate calls: partial failure may
leave an edit partly applied. Deleting the entry cascades to all session children, including children
the client has never loaded.

Metric creation uses shared normalization and canonical units for known keys; empty normalized names
and incompatible units fail. Unknown keys may have custom units. Client duplicate detection is not an
atomic server uniqueness constraint. Import reuse requires both normalized name and key.

## All Workouts

The `workouts` page uses page-context name/icon, URL-backed layout/search, and shared
`workout-list-recipes.ts` recipes:

- `workoutCardsRecipe` pages newest workouts with server aggregate counts/volume and bounded sets for
  best-set previews. Comparison origin is the repeated workout or latest earlier use of the template.
- Comparison/target recipes batch data for loaded workouts; muscle totals exclude stabilizers.
- `workoutWeeksRecipe` aggregates the loaded span with the same search and filter, preserving
  complete week totals across split pages. The cards, count, and weeks recipes take an optional
  compiled filter predicate; the summary recipe ignores search and filters.
- `workoutSummaryRecipe` compares selected rolling periods and supplies personal bests and daily
  consistency totals. `workoutCountRecipe` counts all matches on demand.

Cards, rows, and tables share the same model and entity presentations. They prefer recorded active
duration, otherwise explicitly labeled elapsed duration, and apply display units. No origin means no
comparison.

Filters (started, exercise count, exercises, sets, personal records, template, collections) use the
SDK filter UI and URL state. `client/workouts/filters.ts` declares the fields and compiles the filter
on the client, because plugin `shared/` code may only import plugin-kit and cannot reach the filter
compiler. The Exercises field is a `session-event` field over `workout-set` events on `exercise`
entities.

### Calendar Source

`manifest/calendar-sources.ts` contributes the kernel Calendar source `workouts`: the user's workouts
(not templates) at their `startedAt` instant, captioned with the distinct exercise count from
`workoutTotals`. It has no art or done mark.

## Home

`fitness-home` serves `/`. Without workouts it shows setup progress for goal, workout, template, and
measurement plus import sources. Otherwise independently loaded/retryable panels show:

- A resume-only banner for a device draft; discard remains an explicit editor action.
- Weekly goal/progress and streaks; goal links open the exact plugin's preferences.
- Latest workout with repeat/template actions, pinned measurements, and the shared logging dialog.
- Templates ordered never-used first, then least recently used, with exercise-target chips.
- Muscle activity over seven days: primary targets count 1, secondary ½, legacy untyped links 1,
  stabilizers excluded. Last-session age considers all roles; never-trained targets remain visible.
  Targets are listed once and merged with one grouped aggregate over occurrences unnested by
  recorded target, timed by occurrence start without a workout join.
- The five newest personal-best sets and the count of awarded sets performed in the last 30 days.

## Imports

Imports append history; separate runs may duplicate earlier activity. Generic reporting, replay,
and cancellation contracts belong to [imports](../../kernel/backend/src/modules/imports/README.md).

- Strong supplies source duration as active duration, truncated once, with end time derived from it.
  Excluding pauses is a source assumption, not verified evidence.
- Hevy preserves start/end and leaves active duration unknown: the export has no duration/pause
  evidence.
- OpenScale turns each dated row into one measurement write item. Numeric columns reuse/create
  metrics by normalized label/key and create readings at the row time with its comment. Known keys
  use canonical units; shared property builders also serve interactive writes. A valid date with no
  numeric value is unsuccessful. Row counts are measurements, not individual reading counts. The
  admitted export timezone interprets local timestamps; explicit UTC offsets preserve their instant.
  Nonexistent daylight-saving times fail per row; repeated local times use the earlier occurrence,
  matching the workout importers.

## Workout Editor Contracts

`workout-editor-context` returns defaulted installation settings and trusted Pro availability.
`exercise-override-update` changes only the caller's membership fields; setting a field to null
restores inheritance, while omitted fields stay unchanged.

`workout-editor-save` creates/updates workouts and templates. Baselines and source exercise positions
preserve occurrence/event identity across reorder. Draft encoding and baseline decoding bound
decompression to 128 KiB; encoded drafts and uncompressed complete save inputs have separate 64 KiB
budgets. The draft's retained submission freezes data, baseline, ID, and timestamp, including across
settings changes. The save command commits the entity, sets, relationships, and any new-workout
completion event atomically; asset uploads are separate.

New sets need not be confirmed: creates and historical edits save unconfirmed sets at their supplied
time, while the live editor requires confirmation before finishing. Templates store plans without
execution events. Results distinguish completion, conflicts, validation,
and Pro gates. A known business rejection from the atomic command unlocks edits; uncertain transport
results retain the immutable retry.

Historical edits preserve timestamps. `workout-time-correction` separately changes start/end in
one atomic command that also moves every occurrence of the workout to the new start, and only
sets/clears active duration explicitly, retaining unchanged precision. Free historical edits
preserve protected notes/media and may remove them; adding/changing requires Pro. Template changes
and replacement remain Pro-gated.

Complete source recipes page sets and load selected exercises, membership overrides, and source links.
Unavailable exercises or malformed records block hydration without discarding the baseline. Picker,
taxonomy, and Previous/history reads are not Pro permissions.

One controller per client runtime owns immediate input, ordered device persistence, and active-screen
wake demand. Live progression/rest recovery is draft-owned; historical/template modes start no
execution clocks. Finish reviews included/omitted sets before freezing input. Entry routes check
device recovery first: an existing draft requires Resume or explicit Discard, even when Pro creation
is unavailable. Successful entry replaces the action route with `/workout-editor`; successful save
clears the draft before navigating to the saved entity.

Personal media belongs to the workout or exercise occurrence, never the set. Permanent locators stay
in `exerciseMedia` by exercise order, or in template exercise entries. Drafts track newly uploaded
assets for best-effort abandonment cleanup, never delete loaded attachments on cancel, and retain
pending submission media unchanged. Navigation waits for uploads and persistence. Store locators,
not signed preview URLs.

The Fitness Library picker owns selection, filters, sorting, and device-local presets. Provider
search returns IDs that Fitness reloads and checks for eligibility. Create custom closes the picker
and opens the named exercise editor. Cancelling either picker or workout does not remove already
added library exercises.

### iOS Live Workout Activity

The live editor uses the draft ID as activity key and publishes persisted projections through a
coalescing ordered queue independent of draft persistence/save. It does not start activities for
drafts at least eight hours old, ended/submitted drafts, or ended/dismissed keys. Cards show progress,
timers, and optional next-set targets, not notes, media, or separate measurements. Saving ends with
frozen final duration/count/volume for 30 seconds; discard ends immediately. Host/platform behavior
belongs to the [kernel client](../../kernel/client/README.md#ios-live-activities).

## Automations

- Required user-scoped exercise creation/provider-import hooks upsert Fitness Library membership;
  workout imports include the same link. All Exercises lists members only.
- `fitness.workout-created` handles API-created completion events, excluding import causation, and
  emits `workout.created` from immutable event evidence. The notification formatter reads inline
  signal data, has one attempt, and never retries uncertain external delivery automatically.
- `policy.workout-set` validates a batch against captured exercise/workout references, requires a
  valid workout `startedAt`, and uses `confirmedAt` for occurrence time when present. Otherwise it
  preserves the supplied event time. It preserves recorded exercise kind or fills it from the exercise.
  Writers use workout start for new untimed historical sets. Source schemas reject computed fields.
- `fitness.workout-records` batches changed sets by exercise and requests event-projection work for
  each affected exercise. The common background-work owner dispatches bounded steps; the event stream
  retains its checkpoint, dirty boundary, and freshness state separately from the canonical job status.
  Workers compute statistics/badges per recorded kind into separate projection rows without changing
  source events or replaying historical hooks. Workout start changes trigger
  `fitness.workout-context-records` repairs. A projection is visible only while it matches the current
  source revision and plugin revision/configuration/installation binding; pending or failed status is
  noted and pending queries refresh until processing finishes.
