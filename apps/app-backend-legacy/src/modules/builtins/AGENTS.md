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

For episodic media, progress/dropped/on_hold events carry additional fields:

| Entity    | Extra fields                  |
| --------- | ----------------------------- |
| `show`    | `showSeason`, `showEpisode`   |
| `anime`   | `animeEpisode`                |
| `manga`   | `mangaVolume`, `mangaChapter` |
| `podcast` | `podcastEpisode`              |

`showSeason` and `showEpisode` are mutually required: if one is present, both must be.
`complete` events carry **none** of these fields — completion is always at the whole-entity level.

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
`latestEvent` join returns the most recent event per entity per schema slug using that ordering.
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

- **Non-episodic media** (movie, book, audiobook, etc.): creates a `complete` event immediately
  using the triggering progress event's `occurredAt` for both the event timestamp and
  `completedOn`.
- **Episodic media** (show, anime, manga, podcast): only creates a `complete` event when **all**
  required coverage keys are satisfied — i.e., every episode/chapter of the entity has a
  `progress(100%)` event. If required coverage is missing or empty, the trigger exits without
  creating a `complete` event.

This means a `complete` event for a show represents the whole show being finished, not an
individual episode. The trigger logic walks coverage cycles chronologically and can emit repeated
completions. The trigger logic lives in:
`src/lib/sandbox/scripts/triggers/auto-complete-on-full-progress.txt`.

`consumedOn` is propagated from the triggering progress event to the created complete event via
`event_schema_trigger.metadata.inheritedProperties: ["consumedOn"]`.

### `progressPercent` Validation

- Type: `number`, required, `exclusiveMinimum: 0`, `maximum: 100`, rounded to 2 decimal places.
- The value `0` is not valid. `1` is the intended floor for a freshly started item.
- Values above `100` are not valid and are rejected by schema validation.
