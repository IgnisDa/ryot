# Folds

`modules/derived-values` runs folds and owns `derived_value`. A fold is a read-only plugin script
declared on an entity schema; its entities are its subjects (see
[events](../events/README.md#source-facts-and-derived-values) for routing an event to a subject).

## Contract

The script receives `FoldInput`:

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

The whole input is at most 1 MiB, enough for a stored value and several absorbed values. A change list
that would not fit is dropped, so the subject replays in full; a value and absorbed values that do not
fit fail the fold.

It returns `FoldOutput`:

- `value`: its own state, at most 256 KiB.
- `events`: `{ eventId, properties }` for subject events whose schema declares a projection.
- `relationships`: `{ relationshipId, properties }` for the user's projected links from the subject.
- `changes`: at most 500 event creates, updates and deletes in the change-set format. These
  fold-owned events skip before-policies and after-hooks.

With a change list the fold returns only outputs that changed. The kernel deletes the outputs of events
whose change has no `after` and of links that no longer leave the subject, then upserts what was
returned; a row whose value did not change is not rewritten. Each returned output is validated against
its target alone: the event must belong to the subject and declare a projection, the link must leave
the subject, and the properties must match the projection schema.

When `changes` is not empty, the kernel applies them and runs the fold again with the images of what
they changed. The second run must return no changes, so a fold settles in at most two runs.

## When a fold runs, and in which mode

Every event write runs in the events transaction. Each create, update, delete, merge move and reference
clear records the event's image before the transaction first changes it; entity deletes record the
events whose subject survives the cascade. After the transaction's work and before the event-group
check, the kernel reads the current image of each changed event, routes both images to their subjects,
and folds each subject with its change list. A relationship write folds its source subject with an empty
change list, which refreshes link outputs. A subject gets a full replay when it has no ready subject
row (new, pending or failed), holds absorbed values, was marked whole (an entity content change, a merge,
a fold request or a fold job), has more than 500 changed events, or has a change list too large for
the input bound.

Outside an events transaction, marking queues a `fold` job instead. An event create on the background
lane, such as an import, integration or async hook, also queues one `fold` job per subject, so bulk
writes hold no locks while scripts run. Fold jobs replay their subject in full, are coalesced per user
and subject, run four at a time, and retry up to eight times, one second apart. The last failed attempt
marks the subject failed. Each settled job publishes the user-scoped derived-data-updated hint (see
[entity interest](../../../../client/src/modules/entity-watches/README.md)).

A fold runs inline in the writing transaction through `ScriptCalls`, after the transaction locks the
subject's entity row. A script reads through a savepoint marked read-only inside the writing
transaction, so it sees that write's own changes, and the savepoint is rolled back so the mark cannot
outlive the read. A fold that fails rolls back the source write, so a successful save includes its
required derived state.

## Revisions and replays

A revision install compares each plugin's fold signature (for every fold, its script's content hash and
the definitions of the event schemas it folds, plus projected relationship schemas) between the active
revision and every revision the user's subject rows were folded under. Only a difference, or a user with
no folded rows yet, queues a `fold-rebuild` job; otherwise the user's rows move to the active revision
as they are. Restoring a backup always queues a rebuild. A rebuild discovers subjects from the plugin's
events and projected relationships in pages of 500 and queues each subject's replay as a background
`fold` job.

## Storage and reads

`derived_value` holds one row per target: the subject's own row (`kind = 'subject'`, holding `value`
and `status`), one row per event or relationship output, and transient `absorbed` rows. Each row
records its subject and the plugin revision that wrote it.

RyotQL exposes `event.projection` and `event.projectionStatus`. Its status is `ready` once its subject
row has folded, `pending` while a fold job is queued for the subject or the row is missing, `failed`
when the subject's last fold job failed, and `none` when the schema declares no projection. Backups
export subject fold state in `fold-values.ndjson`, preserving history that cannot be rebuilt from
events, such as suppressed occurrences. Restore and merge remap referenced IDs through absorbed state
before refolding. Event and relationship projections are rebuilt.
