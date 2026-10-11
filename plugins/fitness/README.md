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
`measurement-reading` events carry value, optional comment, and occurrence time. Values logged
together share timestamp/comment. All Measurements uses only page-context name/icon and these
shared recipes:

| Recipe                         | Purpose                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `measurementSummaryRecipe`     | Cursor-paged metrics with latest value/time, first reading, range count, and pin time                               |
| `measurementSeriesRecipe`      | Average plus count series, so zero-filled empty buckets are distinguishable; metric batches respect the query limit |
| `measurementReadingListRecipe` | Newest-first paged log, grouped by timestamp and month                                                              |

Ranges through 1Y use daily buckets; All uses bounded weekly buckets. Trend lines smooth bucket
averages. Loaded rows remain during pagination; malformed/repeated cursors fail rather than loop.
Pinned metrics define tiles and log columns, ordered by pin time. Pins are
`measurement-metric-pinned` relationships to the Fitness Library. Pin requests matching current state
are no-ops; the limit of three is checked before writing, not enforced atomically across concurrent
requests. Metric creation pins while the caller has fewer than two metrics; imports do not pin.

`MeasurementComposer` is shared by the page and live workout editor. It accepts one timestamp,
per-metric finite values (zero included), and an optional comment. Empty values are skipped; at least
one is required. An unchanged timestamp retains seconds. Forms retain input on validation/save
failure and close only on success. Live readings save independently and survive workout discard;
historical/template editors do not offer logging.

Measurement and workout-time forms use the device's named timezone. Nonexistent local times are
rejected. Repeated times show both UTC offsets; edits within the original local date preserve its
offset when valid, while other ambiguous times require an occurrence choice. An explicit choice
overrides the original offset.

`measurement-reading-log` validates every metric's schema/visibility and sends one `createEvents`
batch. The retained submission and mutation receipts replay committed readings without duplication;
partial/skipped writes retain input for retry. Cancelling never rolls back committed readings.

Update/delete validate every reading against both its event and parent metric schema and caller
visibility. Update patches kept readings, creates added values, then deletes cleared values in
separate calls: partial failure may leave an edit partly applied. Delete uses one `deleteEvents`
call. A timestamp row split across pages affects only its loaded readings.

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
- The five newest personal-best sets and count over the last 30 days.

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

Templates store plans without execution events. Results distinguish completion, conflicts, validation,
and Pro gates. A known business rejection from the atomic command unlocks edits; uncertain transport
results retain the immutable retry.

Historical edits preserve timestamps. `workout-time-correction` separately changes start/end and
only sets/clears active duration explicitly, retaining unchanged precision. Free historical edits
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
- `fitness.workout-records` batches changed sets by exercise and dispatches bounded record steps.
  Workers compute statistics/badges per recorded kind into separate projection rows without changing
  source events or replaying historical hooks. Workout start changes trigger
  `fitness.workout-context-records` repairs. Calculated displays remain hidden while results are pending
  or failed, and pending queries refresh until processing finishes.
