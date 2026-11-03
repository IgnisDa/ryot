# Design: declared plugin effects (step 7)

Status: bootstrap entities and membership rules built; projection inputs and dirty-subject work proposed, in that
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

## 2. Membership rules (built)

Media and fitness declare `memberships` in their manifests, copied to `plugin_revision.memberships`:

```ts
memberships: [{
  slug: "media-library",
  relationshipSchemaSlug: "in-media-library",
  targetEntitySchemaSlug: "media-library",
  memberEntitySchemaSlugs: [...],
  join: { entityCreate: [...], providerImport: true, events: true, kernelCollectionAdd: true },
  silentEventProperty: "completionSilent",
  recordEventSchemaSlug: "add-to-media-library",
}]
```

- **Validation:** the slug is unique, the relationship schema is the plugin's own, the target is a
  bootstrap-declared schema so each user has exactly one, `entityCreate` is a subset of the members, and the record
  event belongs to every member schema. An event of the record schema never joins, so it cannot loop.
- **Applied in the source transaction.** `LifecyclePlanner.planChange` plans a change trigger, then calls
  `LifecycleWork.derive`, which the events module binds to `EventMembershipWrites`. It reads the active revision's
  rules for an installed plugin, finds the user's target, locks and inserts the relationship and, for a new one,
  writes the record event with a deterministic ID dated at the relationship's creation. Each derived write's trigger
  is planned the same way, so the summary and history hooks still see it until parts 3 and 4 replace them.
- **Removed:** the three media membership hooks, the fitness one, their scripts, and the nested event workflow.

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
