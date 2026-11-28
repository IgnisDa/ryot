# Folds

`modules/derived-values` runs folds and owns `derived_value`. A fold is a read-only plugin script
declared on an entity schema; its entities are its subjects (see
[events](../events/README.md#source-facts-and-derived-values) for routing an event to a subject).

## Contract

A run folds one or more subjects of one fold. The script receives `FoldInput`, whose `subjects` lists,
for each subject:

- `subjectEntityId` and `value`, what the fold returned last time.
- `absorbed`: values of subjects merged or restored into this one.
- `changes`: `null` asks for a full replay. The fold reads the subject's history and returns every
  output, and the kernel replaces all of the subject's rows. Otherwise it lists one
  `{ before, after }` per changed event. `before` is the event as it was while it belonged to the
  subject when a write first changed it after the subject's last fold, `after` is the event now;
  either is `null` outside the subject. A create has no `before`, a delete or an event that moved to another subject has no
  `after`, and a move into the subject has no `before`. Images carry the event's ID, revision, entity,
  session, schema slugs, occurrence, order key and order creation time (falling back to its ID and
  creation time), and properties, so a deleted event's data is still available.

The whole input is at most 1 MiB and lists at most 25 subjects, which share the run's sandbox budgets.
A change list that would not fit alone is dropped, so the subject replays in full; a value and absorbed
values that do not fit alone fail the fold.

It returns `FoldOutput`, whose `subjects` holds exactly one result per input subject:

- `subjectEntityId`, the subject it answers.
- `value`: its own state, at most 256 KiB.
- `refresh`: when its outputs next change on their own, with no write: `{ date }`, at the start of that
  day in the user's reporting time zone, or `{ instant }`. Omitted when they never do.
- `events`: `{ eventId, properties }` for subject events whose schema declares a projection.
- `relationships`: `{ relationshipId, properties }` for the user's projected links from the subject.
- `changes`: at most 500 `EventChange` items, the schema of a change set's `events.changes`; a
  create names an existing entity. These fold-owned events skip before-policies and after-hooks.

`foldEachSubject` from `@ryot-app/plugin-backend-sdk/folds` builds a run from a per-subject fold that
returns `FoldResult`, a result without its subject ID.

With a change list the fold returns only outputs that changed. The kernel deletes the outputs of events
whose change has no `after` and of links that no longer leave the subject, then upserts what was
returned; a row whose value did not change is not rewritten. Each returned output is validated against
its target alone: the event must belong to its subject and declare a projection, the link must leave
its subject, and the properties must match the projection schema. One invalid result fails the whole
run.

When any subject returns `changes`, the kernel applies them with the run's results and then runs the
fold once more for all subjects they changed, with the images of what changed. A subject that asks for
changes again in its second run is marked `failed`, so a fold settles in at most two runs per subject.

### Batching

A fold folds the pending subjects it is given together: subjects of the same user, plugin and fold
script share runs. It reads their stored state in one statement, builds each subject's input, then
packs inputs first-fit by decreasing size into runs within the input bound and subject limit, so
subjects that fit together make one run. Each run's outputs are validated and written as one set with
the changes it asks for, and the next round folds the subjects those changes queued.

## When a fold runs

Every write runs in one write transaction. Whoever opens it creates a `WriteTransaction` and hands it
to every write in it; fold marks, event group captures and reference clears are kept per transaction
through `writeState`, never in ambient context. Each event create, update, delete, merge move and
reference clear records the event's image before the transaction first changes it; entity deletes
record the events whose subject survives the cascade. An entity update that changes properties records
them with the subjects that may read them: the entity's own and those of the projected events on it or
in its session. After the transaction's work and before the
event-group check, the kernel reads the current image of each changed event, routes both images to
their subjects, and queues each subject. No fold runs inside a transaction.

Queuing stores each subject's change list in `derived_change`, one row per event with its image before
the first change, marks the subject row `pending`, bumps its `revision`, and queues a `fold` job. A
later write to the same subject keeps an event's stored image and bumps the row's `version`, so the
list coalesces. A subject without a row, or marked whole (a change to an entity property its fold
declares in `entityProperties`, a merge or a `replay` fold request), sets the row's `replay` flag
instead of storing changes; a change to the name or any other property folds nothing. A relationship write, a `refresh` fold
request and a passed refresh time mark the subject with no change, which refreshes link outputs. A fold job holds up to 25 subjects of one fold; a
queued job with the same subjects absorbs a new one, and jobs run four at a time.

**Interactive commits** then fold their subjects in the same request, through the function fold jobs
run, on the interactive sandbox lane, and respond once it has written, so a save normally returns with
its derived state. Their jobs wait ten seconds, so they usually find nothing left to fold. A fold that
fails or loses to another leaves the write committed and the subject `pending`, and its job finishes
it. **Background-lane writes** (imports, integrations, async hooks) and provider population only queue.

A fold, an interactive commit's or a job's, holds no transaction while its script runs:

1. It reads its pending subjects' rows, absorbed values and stored changes without locks and builds
   each input. A stored change keeps its image before; its image after is the event now while it still
   belongs to the subject, and a change whose two images are equal drops out. A subject replays in full
   when its row has `replay` set, it holds absorbed values, or its change list has more than 500 events
   or does not fit the input bound.
2. It runs the script with no transaction open.
3. A short transaction locks the subjects' entity rows, as every write to their events does first, and
   their subject rows, then writes the results of the subjects whose value version is still the one it
   read. Only folds bump it, so of two folds that read a subject together one writes and the other runs
   again from the new state. A written subject consumes exactly what the fold read: its absorbed values,
   and each stored change still at the version it read; a change rewritten or stored since stays
   pending. The subject becomes `ready` only when no write marked it since the read. Otherwise it
   stays `pending` and its next fold replays in full, because the script's host reads may already have
   seen part of that write.
4. The changes the results ask for are applied in that transaction, which queues the subjects they
   change, and the fold runs again for those. A subject that asks for changes again while nothing but
   the same fold's writes marked it since that fold wrote it is marked `failed` and `replay`, and the
   fold fails.

A job of several subjects that fails queues each subject as its own job, which leaves every subject
`pending`, so one subject's failure stays its own; a single-subject job retries up to eight times,
one second apart, and its last failed attempt marks the subject `failed` and `replay`. A job that
wrote derived state publishes the user-scoped derived-data-updated hint (see
[entity interest](../../../../client/src/modules/entity-watches/README.md)). A rebuild queues full
replays. A fold request queues a full replay in `replay` mode and a fold with no change in `refresh` mode,
for the requesting user or, with `all-users` scope, every user with a subject row for the entity.

### Refreshes

A value that depends on the current time comes with a `refresh`. Writing a subject stores it on the
subject row, resolved the way a signal schedule's due time is (`dueFrom`): `refresh_at` is the instant,
or the start of the date's day in the user's reporting time zone, and `refresh_on` keeps the date, which
a change of that time zone resolves again in the transaction that changes it. The frequent cron takes up
to 500 subjects whose `refresh_at` has passed, earliest first through a partial index, clears their
refresh, marks them pending with no change and queues their fold jobs. Fold jobs claim in priority
order, and a refresh's jobs come before those of writes and rebuilds. The fold then runs with an empty
change list and returns the next refresh; a subject whose refresh fold fails keeps its value until a write
folds it again.

## Revisions and replays

A revision install compares each plugin's fold signature (for every fold, its script's content hash and
the definitions of the event schemas it folds, plus projected relationship schemas) between the active
revision and every revision the user's subject rows were folded under. Only a difference, or a user with
no folded rows yet, queues a `fold-rebuild` job; otherwise the user's rows move to the active revision
as they are. Restoring a backup always queues a rebuild. A rebuild discovers subjects from the plugin's
events and projected relationships in pages of 500 and queues their replays as background `fold` jobs
of up to 25 subjects.

## Storage and reads

`derived_value` holds one row per target: the subject's own row (`kind = 'subject'`, holding `value`,
`status`, a `revision` that marking the row pending and every rewrite of it bump, a `value_version`
that only folds bump, `replay` when its next fold must replay, and its refresh time), one row per event or relationship
output, and transient `absorbed` rows. Each row records its subject and the plugin revision that wrote
it. `derived_change` holds each subject's change list, with a `version` per row, until a fold consumes
it.

RyotQL exposes `event.projection` and `event.projectionStatus`. Its status is `ready` once its subject
row has folded, `pending` while the subject waits for a fold or the row is missing, `failed`
when the subject's last fold failed, and `none` when the schema declares no projection. Backups
export subject fold state in `fold-values.ndjson`, preserving history that cannot be rebuilt from
events, such as suppressed occurrences. Restore and merge remap referenced IDs through absorbed state
before refolding. Event and relationship projections are rebuilt.
