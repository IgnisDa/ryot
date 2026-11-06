# Derived values

Step 4 replaces event streams, relationship projections, event projections and Media's history
correction with one fold per subject, computed in the transaction that changes its source (rule 5).

## The fold

An entity schema declares `fold: { scriptSlug, eventSchemaSlugs }`. Its subjects are that schema's
entities. An event of a listed slug, owned by the same plugin, belongs to its session entity when the
session's schema folds that slug, and otherwise to its own entity. Fitness folds `workout-set` on
`exercise`. Media folds history on every media schema, so an episode with a show session belongs to
the show and a sessionless special to itself.

Output schemas stay where readers find them: an event schema's `projection: { propertiesSchema }` and
a relationship schema's `projection: { propertiesSchema }`. Neither names a script any more.

The fold script is read-only. It receives `{ subjectEntityId, value, absorbed }`, where `value` is what
it returned last time and `absorbed` lists the values of subjects merged or restored into this one, each
with a map of the IDs it holds. It reads anything else through RyotQL inside the writing transaction, each read
in a savepoint that is rolled back so its read-only mark cannot outlive it. It returns:

- `value`: its own state, such as frozen inventories and suppressed occurrences.
- `events`: one `{ eventId, properties }` for each subject event whose schema declares a projection.
- `relationships`: one `{ relationshipId, properties }` for each of the user's links from the
  subject whose schema declares a projection.
- `changes`: event creates, updates and deletes, in the user-command format. These are the
  fold-owned events, such as Media's automatic completions. They skip before-policies and after-hooks.

When `changes` is not empty, the kernel applies them and runs the fold again. The second run must
return no changes, so a fold settles in at most two runs.

## When it runs

Every event write already runs in the events transaction. The write marks the old and new subjects
of each changed event, and the transaction folds them after its work and before the event-group
check. A relationship write marks its source entity when the schema declares a projection. Outside
an events transaction, marking queues a `fold` job instead.

Event creates on the background lane, including imports, queue `fold` jobs, one per subject, because they
are bulk writes. Changes
from providers reach the fold through `requestFolds({ entityIds })` and the owning plugin's
`requestFoldsForAllUsers({ entityIds })`, which queue jobs. Media calls the latter when a show's status
or inventory changes. A workout's start time moves through set events, so it needs no request.
Installing a new plugin revision or restoring a backup queues one `fold-rebuild` job per user, which
refolds every subject of that plugin.

## Storage and reads

`derived_value` holds one row per target: the subject's own row (`kind = 'subject'`, holding `value`
and `status`) and one row per event or relationship output. Each row records its subject, plugin
revision and the subject's event-scope revision. A fold replaces only the rows whose value changed
and deletes the rest of the subject's rows.

RyotQL keeps `event.projection`, `relationship.projection` and `projectionStatus`. A value is visible
while its plugin revision is the active one, including while a newer fold is pending. Its status is
`ready` once its subject row has folded, `pending` while a fold job is queued for the subject or the
row is missing, `failed` when the subject's last fold job failed, and `none` when no projection is
declared.

## What goes

These go: event streams, stream work and bindings, `event_projection`, relationship projections
with their work and bindings, `background_work` and its workflow, and `requestUserWork`,
`requestEventStreamWork` and `requestRelationshipProjections`. From Media, the paged
history-correction state machine and its four evidence event schemas (`history-correction`,
`completion-occurrence`, `completion-episode` and `history-coverage`) go too.

Automatic completions stay `complete` events carrying `completionKey`. The fold detects a user's
delete or edit from its previous value. A missing derived event becomes a suppressed occurrence,
and an edited one becomes explicit by losing its `completionKey`. A new whole-coverage completion
needs an episode the fold has not counted before, or the subject newly reaching a terminal status, so
a past edit cannot complete a cycle by itself.
