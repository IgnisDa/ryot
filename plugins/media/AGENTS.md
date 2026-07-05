# Media Plugin Agent Notes

## Module Purpose

Owns the media plugin's schemas, relationships, saved views, providers, automations, operations, and
bindings.
The lifecycle semantics below are authoritative for this package.
Media signal definitions select the package's `automation.media-notification` formatter; notification
message vocabulary must remain with the signal owner rather than the kernel.

---

## Operations

Operation scripts live in `scripts/operations/` and are declared in the manifest's `operations`
section; `@ryot/plugin-kit/README.md` owns the generic manifest, driver, and recipe mechanics. The
media-specific rules are:

- **Batch-first.** Every operation takes a list and returns `results` aligned index-for-index with
  that list. No operation gets a single-item signature, and a per-item miss is a value in the
  result (`status: "notFound"`, `entityId: null`) rather than a failure.
- **Input/output schemas live outside the sandbox modules** in `operations/schemas.ts`, so a
  first-party client (the browser extension) can import the schemas and `operations/recipes.ts`
  without pulling a sandbox script body — and its `dist` bundle — into its graph. Sandbox drivers
  import the same module, so the kernel's payload decoding and the client's typing cannot drift.
- **`metadata-lookup`** re-verifies that its integration is a `ryot_browser_extension` integration.
  The kernel's `integration` auth mode only proves the integration exists, is enabled, and whose it
  is; the provider assertion is the script's job. It composes the `movie.tmdb` and `show.tmdb`
  `search` drivers in-process (movie first — result position feeds the match score) rather than
  spawning nested sandbox executions.
- **`resolve-episodes`** expresses the parent-chain filters as one query document per ref with full
  pushdown; it must never fetch episodes and filter in the script. Each document is rooted at the
  episode entity and reaches its parents through correlated `exists` traversals, so one row is
  returned per candidate episode however many relationship rows link it — this is what makes
  "exactly one candidate wins, zero or ambiguous resolves to `null`" hold. User-ownership scoping is
  the query engine's, per executing user.
- `shared/title-parsing.ts` and `shared/title-matching.ts` are a deliberate copy of the kernel's
  `lib/shared` helpers: the kernel keeps its copy while the Netflix import adapter still uses it, and
  the kernel must not import plugin code. Both copies are test-pinned. The plugin copy must stay
  within the sandbox compiler's ES2022 lib, which is why roman numerals are read with an index loop
  instead of `toReversed` — `oxlint --fix` rewrites `[...x].reverse()` back into that ES2023 method.

---

## Media Lifecycle

Six event schemas (`backlog`, `progress`, `complete`, `dropped`, `on_hold`, `review`) are defined per media entity schema in `schemas/entity-schemas.ts` — that file is the source of truth for which properties live on which event. The semantics below are the load-bearing behavior not derivable from the schema alone.

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
- Finish: `progress(100%)` runs the auto-complete subscription (see below)
- Drop before finishing: `dropped` event
- Pause before finishing: `on_hold` event

**Re-watching / re-reading:**

- After a `complete` event, logging a new `progress` event starts a new cycle. The state
  derivation is timestamp-based so the new progress event's `occurredAt` determines current state.
  Multiple `complete` events for the same entity are valid and represent multiple watches.

### Auto-Complete Subscription

The media automation script (`trigger.auto-complete-on-full-progress`,
`scripts/automations/auto-complete-on-full-progress.sandbox.ts`) is bound by a global
event-schema create subscription and runs when a `progress` event is created with
`progressPercent = 100`.

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

`consumedOn` is propagated from the progress event to the created complete event through the
automation rule's server-owned `metadata.inheritedProperties: ["consumedOn"]` value.

### Integration Progress Policy

The media automation script (`trigger.integration-progress-policy`,
`scripts/automations/integration-progress-policy.sandbox.ts`) is bound by a global event-schema
create policy on `progress` at position 100. Its manifest binding is always active; there is no user-facing way to disable it
short of disabling the integration itself. It is a no-op unless the automation origin kind is
`integration`, so it never affects progress events created via the app UI, imports, or the API
directly.

For integration-sourced events it reads the integration's `minimumProgress`/`maximumProgress`
(defaulting to `0`/`100` if unreadable) and applies, in order: a **minimum filter** (below
minimum → event skipped, nothing persisted), a **maximum clamp** (above maximum →
`progressPercent` replaced with `100`), **duplicate suppression** (the entity's most recent
matching progress event — matched by `consumedOn` plus any episodic subitem key — already has the
same post-clamp value → skipped), and a **completion debounce** (post-clamp `100` within
`scheduler.progressUpdateThresholdHours`, default 2h, of a prior matching `progress(100%)` →
skipped, so chatty integrations don't repeatedly start the auto-complete cascade). The exact
skip reasons and matching keys live in the script.

Auto-filling a missing timestamp is **not** this policy's job — it's structural: every sink sets
a progress event's `occurredAt` via `createProgressResult`
(`apps/app-backend/src/modules/integrations/sinks/shared.ts`), defaulting to now, and the
auto-complete subscription reuses that always-present `occurredAt` as the resulting `complete` event's
`completedOn`.
