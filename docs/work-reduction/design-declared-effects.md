# Design: declared plugin effects (step 7)

Status: bootstrap entities, membership rules and projection inputs built; dirty-subject work moved into step 10 of
[`order-of-work.md`](order-of-work.md). The owner approved step 7 and left the order to me.

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
  `LifecycleWork.derive`, which the entities module binds to `PluginMembershipWrites`. It reads the active revision's
  rules for an installed plugin, finds the user's target, locks and inserts the relationship and, for a new one,
  writes the record event with a deterministic ID dated at the relationship's creation. Each derived write's trigger
  is planned the same way, so the summary and history hooks still see it until parts 3 and 4 replace them.
- **Removed:** the three media membership hooks, the fitness one, their scripts, and the nested event workflow.

## 3. Projection inputs (built)

A relationship projection declares the writes that make it stale:

```ts
projection: {
  scriptSlug, propertiesSchema,
  inputs: { eventSchemaSlugs: ["progress", "complete", ...], relationshipCreate: true },
}
```

- **Validation:** every input slug is an event schema of one of the plugin's entity schemas.
- **Applied in the source transaction.** `LifecycleWork.admit` already ran for every change trigger to admit event
  stream work. It now also calls `RelationshipProjectionService.admitInputs`, which reads the plugin's input
  declarations for the user, marks the links from the event's session entity or entity, or the created link,
  arranges the step and returns the job for dispatch after commit. Membership relationships are derived after their
  source event is planned, so `relationshipCreate` is what gives a new title its note.
- **Module boundary.** Events and relationships do not import each other, so the `LifecycleWork` binding and the
  membership writes moved to the entities module, which already depends on both.
- **Removed:** `media.library-summary-refresh` and its script. `media.entity-updated` and
  `media.relationship-sync` still request summaries for property and containment changes.

## 4. Dirty-subject work (moved to step 10)

`reconcile-history` is more than plumbing: it maps episodes to their show or podcast, skips completion-keyed
creates except on episodes, carries the created event IDs as live sources, and forces a pass when a show or podcast
status signal arrives. Its consumer, history correction, requeues on conflicts against the library row that step
10 removes. Building the primitive now would mean shaping it around a request step 10 replaces, on job plumbing
steps 8 and 9 replace, so it lands with step 10. The proposal stands:

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
