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

# Immutable properties

A top-level entity property marked `immutable` keeps its stored value on user-scope updates:
`EntitiesService.update` and the entity editor save fail with `immutable-property` when the final,
post-policy properties change or omit a stored value. The flag comes from the union of the pinned and
active schema. Provider upserts, including user-scope `updateExisting`, and global writes are unaffected
because the provider owns that data.

# Entity editor saves

`POST /entities/editor` saves one user-owned entity and its outgoing user relationships in one
transaction. It is a kernel capability gated by the manifest-declared `editor` on a plugin entity
schema (persisted with the definition and exposed as `entitySchema.editor` in RyotQL). Kernel-owned
schemas and schemas without an editor return `invalid`. Demo users are refused.

Authority is the authenticated user: commands use `source: "api"`, a user initiator, and a null
write context, so writes never borrow a script principal or kernel collection authority. The owner
is resolved with `PluginRuntimeResolver.findPluginAvailableToUser`; unavailable, not-ready,
incompatible, or quarantined installations, other users' private plugins, and relationship slugs
that the user-effective `editor` does not list (or that the owner does not source from this schema)
return `invalid`. The check runs before preparation and again inside the commit transaction under
the shared ingestion lock.

The request carries `idempotencyKey` and `submittedAt`. The execution ID hashes the account
generation, `entity-editor:save`, the schema reference, and the key; `submittedAt` becomes the
command's `occurredAt`. The single `entity-editor:save` receipt retains the entity ID and dispatch
list, so an identical retry replays the result and re-dispatches, while the same key with a
different body fails with `EntityEditorRefused` (409). Changed relationship sets, expected
snapshots, or concurrent state return `stale`. Invalid properties/assets, immutable changes,
duplicate targets, over 200 targets, or over 100 changes return `invalid`. Update targets that are
not the user's own entity of the schema fail with `EntityNotFound`; other declared entity and
relationship failures are typed endpoint errors.
