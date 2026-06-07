# Builtins Module Agent Notes

## Module Purpose

Owns all built-in entity schemas, event schemas, relationship schemas, and saved views. Provides
the seeding logic that populates these into the database at startup.

---

## Media Lifecycle

### Events

Six event schemas are defined per media entity schema in `entity-schemas.ts`:

| Slug       | Meaning                                                          |
| ---------- | ---------------------------------------------------------------- |
| `backlog`  | User intends to consume this item later. No properties.          |
| `progress` | User is actively consuming this item. Carries `progressPercent`. |
| `complete` | User finished the item. Carries timestamps and `completionMode`. |
| `dropped`  | User stopped before finishing. Carries `progressPercent`.        |
| `on_hold`  | User paused before finishing. Carries `progressPercent`.         |
| `review`   | User rated or wrote about this item.                             |

### Shared Properties

`consumedOn` (optional string) is on `progress`, `complete`, `dropped`, and `on_hold`. It records
the source platform (e.g. "Netflix", "Jellyfin"). V2 intentionally stores at most one source
string per event. The aggregate across history is derivable via a query, not stored separately.

`startedOn` (optional datetime) is on `complete`, `dropped`, and `on_hold`. It records when the
user started the current consumption session.

`timeSpent` (optional number, **minutes**) is on `complete`, `dropped`, and `on_hold`.

### Episode-Specific Progress Properties

For `anime` and `manga`, progress/dropped/on_hold events carry additional fields directly:

| Entity  | Extra fields                  |
| ------- | ----------------------------- |
| `anime` | `animeEpisode`                |
| `manga` | `mangaVolume`, `mangaChapter` |

`show` and `podcast` track episode-level progress differently: each has a dedicated
`show-episode` / `podcast-episode` entity schema (with `seasonNumber`/`episodeNumber` on
`show-episode` and `episodeNumber` on `podcast-episode`), and progress/dropped/on_hold events are
logged against those episode entities instead of the parent `show`/`podcast` entity. The `show`
and `podcast` entity schemas themselves exclude the `progress` event schema.

`complete` events carry **none** of the episode-specific fields above — completion is always at
the whole-entity level.

### `complete` Event Properties

| Field            | Required                                                       |
| ---------------- | -------------------------------------------------------------- |
| `completionMode` | Always required. `just_now`, `unknown`, or `custom_timestamps` |
| `completedOn`    | Required when `completionMode = "custom_timestamps"`           |
| `startedOn`      | Optional                                                       |
| `timeSpent`      | Optional (minutes)                                             |
| `consumedOn`     | Optional                                                       |

### State Derivation

Current lifecycle state is **derived** from the latest event per type ordered by `occurredAt`,
then `createdAt`, then `id` — there is no stored "current state" column. The query engine's
generic `first` expression (a top-1 `ORDER BY ... LIMIT 1` subquery) is used to fetch the most
recent event per entity per schema slug using that ordering.
An event type is current when it exists and all other lifecycle event types are either absent or
older than it.

| State       | Predicate summary                                                                    |
| ----------- | ------------------------------------------------------------------------------------ |
| Backlog     | `backlog` exists and is newer than `progress`, `complete`, `dropped`, and `on_hold`. |
| In progress | `progress` exists and is newer than `backlog`, `complete`, `dropped`, and `on_hold`. |
| Completed   | `complete` exists and is newer than `backlog`, `progress`, `dropped`, and `on_hold`. |
| Dropped     | `dropped` exists and is newer than `backlog`, `progress`, `complete`, and `on_hold`. |
| On hold     | `on_hold` exists and is newer than `backlog`, `progress`, `complete`, and `dropped`. |

`dropped` and `on_hold` are terminal states that interrupt "in progress". A new `progress` event
logged after a `dropped` or `on_hold` event resumes the in-progress state.

### Lifecycle Flows

**Log past consumption (no active tracking):**

- One `complete` event with `completionMode: "custom_timestamps"` (if dates are known) or
  `"unknown"`. No preceding progress events are required. Set the event's top-level `occurredAt`
  to the historical completion time; `completedOn` does not replace event chronology.

**Log now (just finished):**

- One `complete` event with `completionMode: "just_now"`. No preceding progress events required.

**Active tracking:**

- Start: `progress` event with `progressPercent: 1`
- Continue: additional `progress` events as consumption proceeds
- Finish: `progress(100%)` triggers auto-complete (see below)
- Drop before finishing: `dropped` event
- Pause before finishing: `on_hold` event

**Re-watching / re-reading:**

- After a `complete` event, logging a new `progress` event starts a new cycle. The state
  derivation is timestamp-based so the new progress event's `occurredAt` determines current state.
  Multiple `complete` events for the same entity are valid and represent multiple watches. The
  built-in episodic auto-complete trigger walks qualifying `progress(100%)` events in chronological
  `occurredAt` order, resets coverage after each full pass, and can emit repeated completions.
  Missing or empty required episodic coverage data yields no completion.

### Auto-Complete Trigger

The built-in sandbox trigger (`trigger.auto-complete-on-full-progress`) fires when a `progress`
event is created with `progressPercent = 100`.

- **Non-episodic media** (movie, book, audiobook, show-episode, podcast-episode, etc.): creates a
  `complete` event immediately using the triggering progress event's `occurredAt` for both the
  event timestamp and `completedOn`.
- **Episodic media** (`anime`, `manga` only): only creates a `complete` event when **all**
  required coverage keys are satisfied — i.e., every episode/chapter of the entity has a
  `progress(100%)` event. If required coverage is missing or empty, the trigger exits without
  creating a `complete` event.

This means a `complete` event for an anime/manga entity represents the whole series being
finished, not an individual episode/chapter. `show` and `podcast` progress is tracked per
`show-episode`/`podcast-episode` entity instead, so each episode completes independently like
non-episodic media. The trigger logic walks coverage cycles chronologically and can emit repeated
completions. The trigger logic lives in:
`src/modules/builtins/sandbox-scripts/triggers/auto-complete-on-full-progress.sandbox.js`.

`consumedOn` is propagated from the triggering progress event to the created complete event via
`event_schema_trigger.metadata.inheritedProperties: ["consumedOn"]`.

### Integration Progress Policy Trigger

The built-in sandbox trigger (`trigger.integration-progress-policy`) is a `before_create` trigger
on the `progress` event schema (position 100). It is a no-op (`{ action: "allow" }`) unless the
incoming event's `trigger.origin` is `"integration"` — it never affects progress events created
via the app UI, imports, or the API directly.

For integration-sourced progress events, it reads the triggering integration's `minimumProgress` /
`maximumProgress` (defaulting to `0` / `100` if either is unreadable) and applies, in order:

- **Minimum filter**: if `progressPercent < minimumProgress`, the event is skipped
  (`reason: "below_minimum_progress"`) — no event is persisted.
- **Maximum clamp**: if `progressPercent > maximumProgress`, the value is replaced with `100`
  (`{ action: "replace", body: { properties: { ...properties, progressPercent: 100 } } }`).
- **Duplicate suppression**: if the entity's most recent matching `progress` event (matched by
  `consumedOn` plus any `animeEpisode`/`mangaVolume`/`mangaChapter` subitem key) already has the
  exact same post-clamp `progressPercent`, the event is skipped (`reason: "duplicate_progress"`).
- **Completion debounce**: if the post-clamp value is `100` and a matching `progress(100%)` event
  already fired within the last `scheduler.progressUpdateThresholdHours` config value (default 2
  hours), the event is skipped (`reason: "completed_recently"`) so chatty integrations polling at
  high frequency don't repeatedly re-trigger the auto-complete cascade above.

Auto-filling a missing timestamp is **not** this trigger's job — it's structural. Every sink's
`MediaImportAdapterResult` sets a progress event's `occurredAt` via `createProgressResult` in
`apps/app-backend/src/modules/integrations/sinks/shared.ts`, which defaults to
`new Date().toISOString()` whenever the source payload has none. The Auto-Complete Trigger above
then reuses that (always-present) `occurredAt` as the resulting `complete` event's `completedOn`,
so a missing completion timestamp ends up filled in "for free" by the progress event's own
fallback, not by a dedicated step in this trigger.

The trigger logic lives in
`src/modules/builtins/sandbox-scripts/triggers/integration-progress-policy.sandbox.js`. It is
registered and seeded active by default alongside the Auto-Complete Trigger (`registry.ts` /
`seed.ts`); there is currently no user-facing way to disable it short of disabling the integration
itself.

### `progressPercent` Validation

- Type: `number`, required, `exclusiveMinimum: 0`, `maximum: 100`, rounded to 2 decimal places.
- The value `0` is not valid. `1` is the intended floor for a freshly started item.
- Values above `100` are not valid and are rejected by schema validation.
