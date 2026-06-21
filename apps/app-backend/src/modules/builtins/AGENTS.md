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

`completionMode` is always required (`just_now`, `unknown`, or `custom_timestamps`);
`completedOn` is required only when `completionMode = "custom_timestamps"`. `startedOn`,
`timeSpent` (minutes), and `consumedOn` are optional.

### State Derivation

Current lifecycle state is **derived** from the latest event per type ordered by `occurredAt`,
then `createdAt`, then `id` — there is no stored "current state" column. The query engine's
generic `first` expression (a top-1 `ORDER BY ... LIMIT 1` subquery) is used to fetch the most
recent event per entity per schema slug using that ordering. A lifecycle event type is the
current state when it exists and every other lifecycle event type is either absent or older
than it.

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
  Multiple `complete` events for the same entity are valid and represent multiple watches.

### Auto-Complete Trigger

The built-in sandbox trigger (`trigger.auto-complete-on-full-progress`,
`sandbox-scripts/triggers/auto-complete-on-full-progress.sandbox.ts`) fires when a `progress`
event is created with `progressPercent = 100`.

- **Non-episodic media** (movie, book, audiobook, show-episode, podcast-episode, etc.): creates a
  `complete` event immediately using the triggering progress event's `occurredAt` for both the
  event timestamp and `completedOn`.
- **Episodic media** (`anime`, `manga` only): creates a `complete` event only when **all**
  required coverage keys are satisfied — every episode/chapter of the entity has a
  `progress(100%)` event; missing or empty required coverage exits without completing. It walks
  qualifying events in chronological `occurredAt` order and resets coverage after each full pass,
  so repeated full passes emit repeated completions (re-watches).

A `complete` event for an anime/manga entity therefore represents the whole series being
finished, not an individual episode/chapter. `show` and `podcast` progress is tracked per
`show-episode`/`podcast-episode` entity instead, so each episode completes independently like
non-episodic media.

`consumedOn` is propagated from the triggering progress event to the created complete event via
`event_schema_trigger.metadata.inheritedProperties: ["consumedOn"]`.

### Integration Progress Policy Trigger

The built-in sandbox trigger (`trigger.integration-progress-policy`,
`sandbox-scripts/triggers/integration-progress-policy.sandbox.ts`) is a `before_create` trigger
on the `progress` event schema (position 100), registered and seeded active by default alongside
the Auto-Complete Trigger (`registry.ts` / `seed.ts`); there is no user-facing way to disable it
short of disabling the integration itself. It is a no-op unless the incoming event's
`trigger.origin` is `"integration"` — it never affects progress events created via the app UI,
imports, or the API directly.

For integration-sourced events it reads the integration's `minimumProgress`/`maximumProgress`
(defaulting to `0`/`100` if unreadable) and applies, in order: a **minimum filter** (below
minimum → event skipped, nothing persisted), a **maximum clamp** (above maximum →
`progressPercent` replaced with `100`), **duplicate suppression** (the entity's most recent
matching progress event — matched by `consumedOn` plus any episodic subitem key — already has the
same post-clamp value → skipped), and a **completion debounce** (post-clamp `100` within
`scheduler.progressUpdateThresholdHours`, default 2h, of a prior matching `progress(100%)` →
skipped, so chatty integrations don't repeatedly re-trigger the auto-complete cascade). The exact
skip reasons and matching keys live in the script.

Auto-filling a missing timestamp is **not** this trigger's job — it's structural: every sink sets
a progress event's `occurredAt` via `createProgressResult`
(`apps/app-backend/src/modules/integrations/sinks/shared.ts`), defaulting to now, and the
Auto-Complete Trigger reuses that always-present `occurredAt` as the resulting `complete` event's
`completedOn`.

### `progressPercent` Validation

`number`, required, `exclusiveMinimum: 0`, `maximum: 100`, rounded to 2 decimal places — `0` is
invalid (`1` is the intended floor for a freshly started item) and values above `100` are
rejected by schema validation.
