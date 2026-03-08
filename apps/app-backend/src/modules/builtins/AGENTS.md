# Builtins Module Agent Notes

## Module Purpose

Owns all built-in entity schemas, event schemas, relationship schemas, and saved views. Provides
the global seeding logic that populates these into the database at startup. Per-user initialization
orchestration lives in `../user-bootstrap/bootstrap.ts`.

---

## Media Lifecycle

Six event schemas (`backlog`, `progress`, `complete`, `dropped`, `on_hold`, `review`) are defined per media entity schema in `entity-schemas.ts` — that file is the source of truth for which properties live on which event. The semantics below are the load-bearing behavior not derivable from the schema alone.

### Episode Tracking

`show` and `podcast` track episode-level progress on dedicated `show-episode` / `podcast-episode` entities, not on the parent — the parent schemas exclude the `progress` event schema entirely. `anime` and `manga` carry episode/chapter fields (`animeEpisode`, `mangaVolume`, `mangaChapter`) directly on their progress/dropped/on_hold events. `complete` is always at the whole-entity level and carries no episode-specific fields.

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
