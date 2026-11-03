# Design: declared plugin effects (step 7)

Status: bootstrap entities built; membership rules, projection inputs and dirty-subject work proposed, in that
order. The owner approved step 7 in [`order-of-work.md`](order-of-work.md) and left the order to me.

## What a media `backlog` event runs today

`probesB0`: 644 ms at the caller, 1,008 statements, 19 workflows and 5 sandbox scripts for one event. The event
itself costs what a no-hook event does, 148 statements and 2 workflows. The rest is four hooks, each a run, a
script and durable host calls:

| Hook | Script does | Replaced by |
| --- | --- | --- |
| `ensure-media-library-membership-on-events` | Upserts `in-media-library` from the title to the user's library | Membership rule |
| `record-media-library-membership-event` | Writes `add-to-media-library` for a new membership | Membership rule |
| `library-summary-refresh` | Maps events and new memberships to titles, then requests projections | Projection inputs |
| `reconcile-history` | Maps events to subjects, then requests user work per subject | Dirty-subject work |

The new membership's relationship and event match the last two hooks again, which is most of the 19 workflows.

## 1. Bootstrap entities (built)

A `userBootstrap` entry lists `entities` instead of naming a script. The kernel ensures them with kernel authority,
one per schema and user, from signup and the installation workflow. Its receipt is keyed by the installation and
entry and dated at the installation's creation, so a retry replays the same command. The write runs in an
activity and returns its hook dispatch plans, which the workflow body dispatches. Scripts remain for setup that
needs logic.

## 2. Membership rules

A plugin declares:

```ts
memberships: [{
  slug: "media-library",
  relationshipSchemaSlug: "in-media-library",
  targetEntitySchemaSlug: "media-library",
  memberEntitySchemaSlugs: [...],
  on: { entityCreate: [...], providerImport: true, events: true, kernelCollectionAdd: true },
  exceptEventSchemaSlugs: ["add-to-media-library"],
  skipWhenEventProperty: "completionSilent",
  recordEventSchemaSlug: "add-to-media-library",
}]
```

- **Validation:** the relationship schema is the plugin's own and points from member schemas to the target; the
  target is a bootstrap-declared entity, so each user has exactly one; the record event belongs to every member
  schema.
- **Applied in the source transaction.** The event, entity and import-completion commits collect member entities
  their written items name, as the scripts did today, including the kernel collection event's `entityId` property
  for entities the plugin owns. The kernel then upserts the relationship to the user's target, and for each newly
  inserted one writes the record event, dated at the relationship's creation.
- **Ports, as for bootstrap.** Events and relationships do not import each other, so the commit calls a
  `PluginMembershipRules` port that boot binds to the entity and relationship services. The derived writes use the
  existing prepare-and-persist APIs that join the caller's transaction, so receipts, projection bindings and event
  scopes stay correct. Their own hook matches are planned and dispatched with the source's.
- **Removes** both membership hooks and their scripts, and the nested event workflow the second one started.

## 3. Projection inputs

A relationship projection declares the writes that make it stale:

```ts
projection: {
  scriptSlug, propertiesSchema,
  inputs: { events: [...eventSchemaSlugs], via: "session-or-entity", relationshipCreate: true },
}
```

The event commit marks the notes of the user's links from the event's session entity, or its entity, and admits
the projection work, in the same transaction. This is what `requestRelationshipProjections` does today from a
hook. Relationship creates of the schema mark their own note. Removes `library-summary-refresh`.

## 4. Dirty-subject work

A plugin declares user work keyed by subject, run once per subject however many writes mark it:

```ts
subjectWork: [{
  slug: "history-correction",
  scriptSlug: "...",
  events: [...eventSchemaSlugs],
  subject: "session-or-entity",
}]
```

The commit upserts one row per user, plugin and subject, and a worker runs the script for each dirty subject,
passing the event IDs marked since the last run. Writes during a run leave the row dirty for one more pass. This
replaces `reconcile-history`'s run, script and `requestUserWork` call per write. Media's history correction keeps
its script; only the plumbing in front of it goes.

## Check

No after hook on a backlog create, no script at signup, summaries equal their live values, and the e2e files for
library membership, summaries and history correction pass. Flow probes after each part.

## Risks

- **Ordering.** Today the membership event is written after the source commit, by a later workflow. Writing it in
  the same transaction changes `createdAt` ordering between the source and the membership event; tests that read
  the order of a title's first events need checking.
- **Lock scope.** The source transaction now also locks the target library entity and its relationship identity,
  which serializes a user's concurrent writes on one row. Today the hook already takes the same locks, a little
  later.
- **Private plugins** keep hooks. The rule vocabulary covers only what the first-party scripts do.
