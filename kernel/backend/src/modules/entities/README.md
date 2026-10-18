# Entity mutation results

Entity-returning create, update, and upsert commands retain one `ListedEntity` snapshot in
their receipts. A no-op retains the entity returned by that command. Replay reads the
receipt before reading the source, so later updates or deletion cannot change the result.

Ensure-user and global-batch item receipts retain only `entityId` and `wasInserted`, which
their external results require. A delete item receipt retains `null`; its identity proves
completion, and the batch receipt retains the deleted count.

The entity persistence operation builds change evidence in the source-write transaction.
Matching hook plans, receipt results, dispatch references, and conditional batch evidence
commit with the source. Result codecs do not contain universal before/after outcomes.
Prepared policy inputs still retain the source snapshot needed to detect concurrent changes.

Provider root-write activities retain the entity snapshot and dispatch references.
Collection preparation projects the entity result to its identifier before journaling it.

# Provider ownership

Provider-backed entity ownership follows the provider's plugin: system-plugin providers write global
entities, and private-plugin providers write entities owned by that plugin's user. Shared draft
validation rejects a different scope with `provider-scope-mismatch` during preparation and commit,
including ordinary and planned upserts. Entities without provider provenance remain user-owned when
created through the user API.

# Immutable properties

A top-level entity property marked `immutable` keeps its stored value on user-scope updates:
`EntitiesService.update` and the entity editor save fail with `immutable-property` when the final,
post-policy properties change or omit a stored value. The flag comes from the union of the pinned and
active schema. Provider upserts, including user-scope `updateExisting`, and global writes are unaffected
because the provider owns that data.

# Entity editor saves

`POST /entities/editor` saves or deletes one user-owned entity together with its declared user
relationships in one transaction. It is a kernel capability gated by the manifest-declared `editor`
on a plugin entity schema (persisted with the definition and exposed as `entitySchema.editor` in
RyotQL). Kernel-owned schemas and schemas without an editor return `invalid`. Demo users are refused.

An editor lists relationships with a direction: `outgoing` links start at the edited entity,
`incoming` links end at it, and a `parent` link is an incoming link that needs exactly one related
entity at creation and cannot change afterwards. Relationship write policies apply to the stored
source, so a `source-owner` parent must belong to the user. `deletable: true` allows the `delete`
action.

Authority is the authenticated user: commands use `source: "api"`, a user initiator, and a null
write context, so writes never borrow a script principal or kernel collection authority. The owner
is resolved with `PluginRuntimeResolver.findPluginAvailableToUser`; unavailable, not-ready,
incompatible, or quarantined installations, other users' private plugins, and relationship slugs
that the user-effective `editor` does not list (or whose declared end is not this schema) return
`invalid`. The check runs before preparation and again inside the commit transaction under the
shared ingestion lock.

The request carries `idempotencyKey` and `submittedAt`. The execution ID hashes the account
generation, the action, the schema reference, and the key; `submittedAt` becomes the command's
`occurredAt`. The single `entity-editor:save` receipt retains the entity ID and dispatch list, so an
identical retry replays the result and re-dispatches, while the same key with a different body fails
with `EntityEditorRefused` (409). Updates carry the loaded entity snapshot and the original user
relationship groups for every submitted schema, including empty groups. Relationship baselines
compare related entities and properties independently of array order. Changes since loading or
during save preparation return `stale`; no entity or relationship diff is committed. Baseline and
submitted schemas must match. Invalid properties/assets, immutable changes, duplicate targets, over
200 targets, or over 100 changes return `invalid`. Update targets that are not the user's own entity
of the schema fail with `EntityNotFound`; other declared entity and relationship failures are typed
endpoint errors.

A delete carries the loaded `updatedAt`; a newer entity returns `stale`. It returns `invalid` when the
entity has any history or any user relationship other than its declared editor links, so children
must be removed first. Entity deletion re-checks history in its commit transaction and never cascades
events. Identical retries replay through the entity delete receipts.

# Graph retention

Provider entities carry `check_after`, initially seven days after creation. Provider updates and
entity interest push it to at least seven days from now. The frequent cron collects due provider
entities in bounded batches; user-owned entities without a provider are never collected.

Composition links (relationship schemas declaring `retention: composition` in the active plugin
revision) join entities into units that are kept or deleted together. A unit is live when any member:

- has no provider or is not yet due;
- is an event's entity or session entity;
- has a user-scoped relationship or a link whose schema declares `retention: root`;
- has a queued, running or retrying enrichment request, or a pending provider-import admission;
- is named by an `entity-id` property of an event, a relationship, or an entity without a provider;
- appears in the payload of queued or running background work or automation runs, or in a saved view.

Other global links are references. A dead unit stays when a reference links it to a live unit, but
units kept this way do not keep their own references. Kept units are deferred seven days. The rest are
deleted, and foreign keys remove their relationships, translations and enrichment requests. Surviving
neighbors that lost a reference get a null `relatedPopulatedAt`, so foreground interest fetches their
related data again. Managed assets they used become unreferenced and follow the asset collector.

A batch locks unit members `FOR UPDATE SKIP LOCKED` and skips any unit with a member a writer holds,
so a writer either commits its reference before the check or fails on the deleted row. Collection
waits while any backup export or restore is pending or running.
