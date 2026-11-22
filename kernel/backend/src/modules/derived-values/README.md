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
  subject when the transaction first changed it, `after` is the event now; either is `null` outside
  the subject. A create has no `before`, a delete or an event that moved to another subject has no
  `after`, and a move into the subject has no `before`. Images carry the event's ID, revision, entity,
  session, schema slugs, occurrence, order key and order creation time (falling back to its ID and
  creation time), and properties, so a deleted event's data is still available.

The whole input is at most 1 MiB and lists at most 25 subjects, which share the run's sandbox budgets.
A change list that would not fit alone is dropped, so the subject replays in full; a value and absorbed
values that do not fit alone fail the fold.

It returns `FoldOutput`, whose `subjects` holds exactly one result per input subject:

- `subjectEntityId`, the subject it answers.
- `value`: its own state, at most 256 KiB.
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

When any subject returns `changes`, the kernel applies every subject's changes and then runs the fold
once more for all subjects they changed, with the images of what changed. A subject's second run must
return no changes, so a fold settles in at most two runs per subject.

### Batching

The kernel folds every subject a fold step collects together: subjects of the same user, plugin and
fold script share runs. It locks their entity rows and reads their stored values in one statement each,
builds each subject's input, then packs inputs first-fit by decreasing size into runs within the input
bound and subject limit, so subjects that fit together make one run. Each run's outputs are validated
and written as one set. Changes from every run are applied after all of the step's runs, and the next
step collects whatever they marked.

## When a fold runs, and in which mode

Every write runs in one write transaction. Whoever opens it creates a `WriteTransaction` and hands it
to every write in it; fold marks, event group captures and reference clears are kept per transaction
through `writeState`, never in ambient context. Each event create, update, delete, merge move
and reference clear records the event's image before the transaction first changes it; entity deletes
record the events whose subject survives the cascade. After the transaction's work and before the
event-group check, the kernel reads the current image of each changed event, routes both images to
their subjects, and folds or queues each subject. A relationship write refolds its source subject with
an empty change list, which refreshes link outputs. A subject gets a full replay when it has no ready
subject row, holds absorbed values, was marked whole (an entity content change, a merge or a fold
request), has more than 500 changed events, or has a change list too large for the input bound.

**Interactive commits** fold inline in the writing transaction through `ScriptCalls`, after the
transaction locks its subjects' entity rows, one run per fold while the subjects fit (see
[Batching](#batching)). A script reads through a savepoint marked read-only inside the writing
transaction, so it sees that write's own changes, and the savepoint is rolled back so the mark cannot
outlive the read. A fold that fails rolls back the source write, so a successful save includes its
required derived state.

Interactive folds stay inside the transaction on purpose. The subject's entity row is locked for the
fold script's run (on a clone, 91 of 112 ms for a large show, 44 of 107 ms for a 34-set workout), but
folding after the commit would let a save succeed while its fold fails or is not yet written, and
keeping the guarantee outside the transaction would repeat the source writes in a second one, which is
slower than holding the lock.

**Background-lane writes** (imports, integrations, async hooks) queue `fold` jobs instead, so bulk
writes hold no locks while scripts run. Their transaction stores each subject's change list in
`derived_change`, one row per event with its image before the first change, marks the subject row
`pending` and bumps its `revision`. A later write to the same subject keeps an event's stored image,
so the list coalesces. A subject without a row, or marked whole, sets the row's `replay` flag instead
of storing changes. A fold job holds up to 25 subjects of one fold; a queued job with the same subjects
absorbs a new one, and jobs run four at a time.

A fold job runs outside any transaction:

1. It reads its pending subjects' rows, absorbed values and stored changes without locks and builds
   each input. A stored change keeps its image before; its image after is the event now while it still
   belongs to the subject, and a change whose two images are equal drops out. A job's change list
   therefore equals what one commit over the same writes would have produced, and the replay fallbacks
   above apply unchanged.
2. It runs the fold with no transaction open.
3. A short transaction locks the subjects' entity rows, rereads their revisions and writes the results
   of the subjects still at the revision they were read at, deleting their stored changes. A subject
   written since keeps its row `pending` and runs again from its new state. After two reruns the job
   marks the remaining subjects for a refold in a transaction of its own, which folds them inline under
   their locks, so a job always finishes.

Every write that changes a subject's events also locks its entity row, as does every fold before it
reads stored changes, so no change joins a list between a fold reading and consuming it. An
interactive commit that folds a subject with stored changes consumes them too. A rebuild and an
explicit fold request stay full replays.

A job of several subjects that fails queues each subject as its own job, which leaves every subject
`pending`, so one subject's failure stays its own; a single-subject job retries up to eight times,
one second apart, and its last failed attempt marks the subject `failed` and `replay`. Each settled job
publishes the user-scoped derived-data-updated hint (see
[entity interest](../../../../client/src/modules/entity-watches/README.md)).

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
`status`, a `revision` that marking the row pending and every rewrite of it bump, and `replay` when
its next fold must replay), one row per event or relationship output, and transient `absorbed` rows. Each row records its
subject and the plugin revision that wrote it. `derived_change` holds background-lane change lists
until their subject folds.

RyotQL exposes `event.projection` and `event.projectionStatus`. Its status is `ready` once its subject
row has folded, `pending` while a fold job is queued for the subject or the row is missing, `failed`
when the subject's last fold job failed, and `none` when the schema declares no projection. Backups
export subject fold state in `fold-values.ndjson`, preserving history that cannot be rebuilt from
events, such as suppressed occurrences. Restore and merge remap referenced IDs through absorbed state
before refolding. Event and relationship projections are rebuilt.
