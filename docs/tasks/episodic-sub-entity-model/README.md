# Episodic Sub-Entity Model

## Problem Statement

When a user tracks a show or a podcast, the seasons and episodes that make up
that show or podcast are not real, addressable things in the system. They exist
only as nested arrays buried inside a single blob of data hanging off the parent
show/podcast. This causes concrete pain:

- A user cannot reliably point at "Season 2, Episode 4" as a thing. Watch
  progress is recorded as loose positional numbers attached to the _show_, not
  to the episode, so the system can neither validate nor reason about it.
- A user cannot ask natural questions across episodes — "which episodes have I
  watched?", "shows where I've watched more than ten episodes", "shows with at
  least one episode longer than 90 minutes" — without bespoke one-off code.
- An individual episode or season cannot carry its own information or its own
  relationships (e.g. a guest appearance on one episode).
- Because progress is positional and opaque, two integrations reporting the same
  watch can be hard to de-duplicate, and the data is fragile to provider
  changes.

Anime and manga do not have this problem: their tracking is intentionally flat
(a total episode/chapter count plus a bare number per progress event), and there
is no per-episode metadata worth promoting. They are explicitly excluded.

## Solution

Promote seasons and episodes to first-class entities, exactly like the shows and
podcasts that contain them. A show owns season entities; a season owns episode
entities; a podcast owns episode entities. The ownership is expressed with the
same relationship mechanism used everywhere else in the system.

From the user's perspective:

- Each season and each episode is a real, addressable item with its own title,
  artwork, air date, runtime, and description.
- Watching an episode records progress against _that episode_. Finishing it
  (100%) marks the episode complete automatically.
- The show as a whole is still something the user can put in their backlog, mark
  complete, drop, put on hold, or review.
- "Shows I'm currently watching" and "shows I've fully watched" are derived from
  episode progress automatically — no separate bookkeeping, and the user keeps
  the ability to mark a show or a season complete by hand.
- A show's season/episode tree, and which episodes the user has watched, can be
  fetched in a single query and used for filtering, sorting, and counting.
- Watch history imported from other services, and live "now playing" events from
  media servers, land on the correct episode when the episode can be identified.

## User Stories

1. As a show watcher, I want each episode to be a distinct trackable item, so
   that I can mark individual episodes as watched.
2. As a show watcher, I want to record progress on a specific episode (including
   a partial percentage), so that resume/partial viewing is captured.
3. As a show watcher, I want an episode to be marked complete automatically when
   I reach 100% on it, so that I do not have to mark it by hand.
4. As a show watcher, I want to see a show's seasons in order and each season's
   episodes in order, so that I can navigate the structure.
5. As a show watcher, I want to see which episodes I have already watched, so
   that I know where I left off.
6. As a show watcher, I want "shows I'm currently watching" to reflect my
   per-episode progress, so that my in-progress list is accurate.
7. As a show watcher, I want a show to count as fully watched once I have watched
   all its episodes, derived automatically, without losing the ability to mark it
   manually.
8. As a show watcher, I want to mark an entire season as complete, so that I can
   record season-level completion explicitly.
9. As a show watcher, I want to still mark the whole show as backlog, complete,
   dropped, on hold, or reviewed at the show level.
10. As a podcast listener, I want each podcast episode to be a distinct trackable
    item.
11. As a podcast listener, I want to record listening progress per episode and
    have an episode auto-complete at 100%.
12. As a user, I want each season/episode to carry its own metadata (title,
    artwork, air/publish date, runtime, description) so that detail views are
    accurate.
13. As a user, I want individual episodes and seasons to be able to carry their
    own relationships in the future (e.g. guest appearances), so that the model
    does not block per-episode data.
14. As a user importing history from a media service (e.g. Jellyfin, Emby, Plex,
    Trakt, Netflix, a generic media tracker), I want each per-episode watch to
    attach to the correct episode.
15. As a user with a live integration (Jellyfin, Emby, Plex, Kodi, browser
    extension), I want "now watching S2E4" to record against that episode.
16. As a user, I want duplicate progress events for the same episode to be
    de-duplicated.
17. As a user importing podcasts (e.g. from Audiobookshelf), I want per-episode
    progress to attach to the right podcast episode when the episode can be
    identified.
18. As a user, I do not want individual episodes and seasons cluttering my media
    browse and search; they are structural parts of a show, not standalone
    library items.
19. As a user migrating from the previous version, I want my historical
    per-episode watch history preserved and attached to episodes.
20. As a user migrating from the previous version, I want my show/podcast
    completion history preserved.
21. As a user migrating from the previous version, I want my historical reviews
    that referenced a specific episode preserved.
22. As a query author, I want to fetch a show with its seasons and episodes
    nested inside the result in one query.
23. As a query author, I want nested seasons ordered by season number and nested
    episodes ordered by episode number.
24. As a query author, I want each nested episode to indicate whether I have a
    progress or complete event for it.
25. As a query author, I want to filter shows by episode-level conditions (e.g.
    shows where I have completed more than N episodes).
26. As a query author, I want to count watched episodes per show without a
    dedicated endpoint.
27. As an anime or manga watcher, I want my existing flat episode/chapter
    tracking to keep working exactly as before.
28. As a user re-syncing a show or podcast, I do not want duplicate season or
    episode entities created.
29. As a user, I want progress I report for an episode that cannot be matched
    (e.g. provider numbering mismatch) to be skipped rather than mis-attached to
    the wrong episode.
30. As a user, I want specials (season 0) to appear as a season, while not
    blocking "fully watched" from being reached by the regular seasons.

## Implementation Decisions

### Background: the generic V2 model

The backend (the TypeScript/Effect service that this PRD targets) deliberately
replaces domain-specific resolvers with a single generic model. The relevant
building blocks:

- **Entity schema**: a builtin or user-defined "type" (e.g. `show`, `podcast`,
  `movie`, `person`). Identified by a kebab-case `slug`. It carries a properties
  schema (an "AppSchema" — a field-descriptor object that is the source of truth
  for validating an entity's `properties`) and a set of event schemas.
- **Entity**: an instance of an entity schema. It has a builtin `name` (required,
  non-empty), a builtin `image` (a single image: either a remote URL or an S3
  key, or null), a `properties` JSON blob validated against the schema's
  AppSchema, an optional provider-native `externalId`, and a `populatedAt`
  timestamp (null until fully populated).
- **Relationship schema**: a builtin or user-defined directed link type with a
  `slug`, a source entity schema, and a target entity schema. A relationship row
  links a specific source entity to a specific target entity.
- **Event schema / event**: lifecycle events (`backlog`, `progress`, `complete`,
  `dropped`, `on_hold`, `review`) recorded against an entity. Consumption state is
  not stored as a status column; it is _derived from events_ through the query
  engine.
- **Population**: when an entity is first referenced, a sandbox "details" script
  for its provider runs, returns the entity's `name`, `image`, `properties`, and a
  list of related entities; a durable workflow writes the entity and its related
  entities (and the relationship rows linking them) as individually-named
  activities, then marks the entity populated. Population is idempotent and keyed
  on `externalId`.
- **Triggers**: builtin sandbox scripts attached to event schemas that run before
  or after an event is created (e.g. an auto-complete trigger, an integration
  de-duplication policy).
- **Query engine**: the single read path. It already supports recursive
  hierarchical includes (fetch parents with nested children and grandchildren),
  per-include ordering by a child property, directional relationship traversal,
  cross-schema existence/aggregate filters, top-level-only pagination, and
  engine-enforced per-user data isolation. No query-engine changes are required.
- **Legacy bootstrap**: a one-time SQL migration that imports data from the
  previous (Rust) version's database into this generic model.

Today, a show stores its seasons (each with nested episodes) as an array inside
its `properties`; a podcast stores an episodes array plus a total-episode count.
Episode progress is stored as positional numbers (season/episode/podcast-episode)
inside each progress event's `properties`, with the event pointing at the show or
podcast entity.

### New builtin entity schemas

Three new builtin entity schemas. `name` holds the title; `image` holds the
primary poster/still/artwork.

`show-season`

| Property       | Type    | Required |
| -------------- | ------- | -------- |
| `seasonNumber` | integer | yes      |
| `description`  | string  | no       |
| `releaseDate`  | date    | no       |

`show-episode`

| Property        | Type              | Required |
| --------------- | ----------------- | -------- |
| `episodeNumber` | integer           | yes      |
| `seasonNumber`  | integer           | yes      |
| `runtime`       | integer (minutes) | no       |
| `publishDate`   | date              | no       |
| `description`   | string            | no       |

`podcast-episode`

| Property        | Type              | Required |
| --------------- | ----------------- | -------- |
| `episodeNumber` | integer           | yes      |
| `runtime`       | integer (minutes) | no       |
| `publishDate`   | date              | no       |
| `description`   | string            | no       |

Notes:

- `seasonNumber` is denormalized onto `show-episode` so the episode is
  self-describing ("S2E4") and resolution does not depend solely on traversing
  through the season.
- Ordering numbers are integers that **allow 0** (specials live in season 0).
- These schemas are **structural**: they are NOT linked to the "media" tracker
  and NOT added to the curated set of media browse views. They are reached only
  via a parent's nested includes and as relationship targets; they never appear
  as standalone, searchable/browsable library items.

### New builtin relationship schemas

| Slug                          | Source        | Target            |
| ----------------------------- | ------------- | ----------------- |
| `show-to-show-season`         | `show`        | `show-season`     |
| `show-season-to-show-episode` | `show-season` | `show-episode`    |
| `podcast-to-podcast-episode`  | `podcast`     | `podcast-episode` |

No custom properties on any of these relationships. Each relationship is resolved
at population time by the (source schema, target schema) pair, consistent with
how existing related-entity relationships are resolved; there is exactly one
builtin relationship per pair.

### Modified parent schemas

- The show properties schema loses its nested seasons array.
- The podcast properties schema loses its nested episodes array.
- Lightweight denormalized counts are **kept** for cheap list/card display,
  written at population time: `totalSeasons` and `totalEpisodes` on `show`,
  `totalEpisodes` on `podcast`. (These are simple integers, not the structural
  data, and they preserve existing display behavior.)
- The AppSchema field-descriptor objects are the authoritative source of truth
  for entity properties; the parallel Effect-`Schema` struct definitions for show
  /podcast/season/episode properties are dead (zero consumers) and are removed.

### Event-model changes

| Entity schema            | Events after change                                                   |
| ------------------------ | --------------------------------------------------------------------- |
| `show`                   | `backlog`, `complete`, `dropped`, `on_hold`, `review` (no `progress`) |
| `podcast`                | `backlog`, `complete`, `dropped`, `on_hold`, `review` (no `progress`) |
| `show-season`            | `complete`                                                            |
| `show-episode`           | `progress`, `complete`                                                |
| `podcast-episode`        | `progress`, `complete`                                                |
| anime, manga, all others | unchanged                                                             |

- A `progress` event carries only `progressPercent` and `consumedOn`. The
  positional `showSeason`/`showEpisode`/`podcastEpisode` fields are removed from
  the progress (and review) property builders for show/podcast — the episode
  entity _is_ the identity now.
- The anime/manga progress property fields (`animeEpisode`, `mangaChapter`,
  `mangaVolume`) are untouched.
- A show-level `progress` percentage is meaningless at episode granularity, which
  is why it is removed from `show`/`podcast`.

### Identity, idempotency, and resolution

- **Sub-entity `externalId` is the provider-native id** (e.g. the provider's own
  season id and episode id). The positional `seasonNumber`/`episodeNumber` live in
  `properties`.
- **Population creates sub-entities idempotently** keyed on
  (`externalId`, entity schema, the parent's populating script, global ownership).
  Re-population creates no duplicates.
- **Positional progress sources cannot compute provider-native ids.** Import
  adapters, live integration sinks, and the legacy migration only know
  "show + season number + episode number" (or "podcast + episode number"). They
  therefore **resolve** the episode entity by walking the relationship graph and
  matching the ordering number; they do **not** create episodes.
- **Populate-first ordering**: because positional sources resolve rather than
  create, the parent's full season/episode tree must already exist when progress
  is recorded. This holds: the import and sink flows populate (or look up an
  already-populated) parent entity before creating its events, and population now
  creates the whole tree.
- **Drop-on-miss**: if an episode cannot be resolved (e.g. provider numbering
  mismatch, or a sink event lacking a season number), the progress event is
  skipped and logged. There is no show-level progress fallback.

### Module: Child-Entity Tree Processor (new, deep)

A recursive processor that turns a tree of child-entity descriptors into entities
and relationship rows, reused by the population workflow.

- **Input**: a parent entity (its id, its schema, and the script that populated
  it) and an ordered tree of child nodes. Each node has: a target entity schema
  slug, a provider-native `externalId`, a `name`, an optional `image` (remote URL
  or S3 key), a `properties` object (validated against the target schema's
  AppSchema), and an optional list of nested child nodes.
- **Behavior**: depth-first, **parent before child**. For each node: resolve the
  target entity schema by slug; create-or-update the global entity keyed on its
  `externalId` (inheriting the parent's populating script, setting `image`,
  `name`, validated `properties`, and `populatedAt` = now, since the child's data
  arrives complete inside the parent's details response and has no standalone
  population script); resolve the relationship schema by the (parent schema, child
  schema) pair; upsert the parent→child relationship row; then recurse with this
  node as the new parent.
- **Idempotent**: re-running over the same tree produces no duplicate entities or
  relationships (insert-if-absent on the entity's unique key; upsert on the
  relationship's unique key).
- **Durability**: each entity write and each relationship write is performed as a
  uniquely-named durable workflow activity, consistent with how related-entity
  writes are already named, so workflow replay does not duplicate rows.

### Sandbox provider output shape

The show and podcast "details" scripts stop emitting nested season/episode arrays
inside `properties` and instead emit the structural data as the child-entity tree
the processor consumes:

- Show: a tree of season nodes, each with episode nodes nested under it.
- Podcast: a flat list of episode nodes.
- Each node provides the provider-native `externalId`, a `name` (with a
  synthesized fallback of "Season N" / "Episode N" when the provider title is
  empty, since `name` is required), an `image` built from the provider's primary
  poster/still/thumbnail (as a remote-URL image), and the node's `properties`
  (ordering number, description, dates, runtime).
- The scripts also emit the denormalized `totalSeasons`/`totalEpisodes` counts on
  the parent.
- Sub-entities do not get an images-gallery property; a single primary `image`
  per season/episode is sufficient.

### Module: Episode Resolver (new, deep)

A focused resolver from positional coordinates to an episode entity, reused by the
import pipeline, the sinks, and the legacy migration.

- `resolveShowEpisode(showEntityId, seasonNumber, episodeNumber)` → episode entity
  id or null: find the show's season child (via `show-to-show-season`) whose
  `seasonNumber` matches, then that season's episode child (via
  `show-season-to-show-episode`) whose `episodeNumber` matches.
- `resolvePodcastEpisode(podcastEntityId, episodeNumber)` → episode entity id or
  null: find the podcast's episode child (via `podcast-to-podcast-episode`) whose
  `episodeNumber` matches.
- Implemented as direct graph traversal over relationship + entity rows, filtering
  on the ordering number stored in `properties`. Respects per-user data
  isolation. Returns null on no match or an ambiguous match; the caller decides
  what to do (drop + log).

### Import pipeline and adapters

- The import event model gains an optional episode locator (season number +
  episode number for shows; episode number for podcasts).
- The import pipeline, after the parent entity is populated, resolves the locator
  via the Episode Resolver and sets the event's target entity to the resolved
  episode; unresolved locators cause the event to be dropped and logged.
- The show import adapters (Jellyfin/Emby, Trakt, Netflix, Plex, Watcharr, the
  generic media tracker) and the podcast import adapter (Audiobookshelf) emit the
  locator instead of writing positional numbers into event properties.
- The anime/manga import adapters are out of scope and unchanged.

### Integration sinks (live)

- The shared progress-result builder used by the live sinks takes the episode
  locator instead of positional fields, and the resulting event is resolved to an
  episode entity through the same Episode Resolver path.
- The show sinks (Jellyfin, Emby, Plex, Kodi, browser extension) are updated.
  There are no live podcast sinks. Sink events that lack a season number cannot be
  resolved and are dropped + logged.

### Auto-complete trigger rework

- A builtin after-create trigger auto-completes an entity when a `progress` event
  reaches 100%. It is wired to every `progress` event schema automatically at seed
  time, so the new episode `progress` schemas pick it up.
- Episodes are atomic: when an episode's progress reaches 100%, the trigger emits
  a `complete` event on that episode. (This is why episodes have a `complete`
  event schema.)
- The trigger's old show/podcast logic — which computed "all episodes covered"
  from the now-removed nested blob and positional keys — is removed.
- The anime/manga branches of the trigger, which compute coverage from flat counts
  and positional keys, are left unchanged.

### Integration progress-policy trigger

- A builtin before-create trigger de-duplicates integration progress events.
- The show/podcast positional keys are removed from its sub-item key set. For
  show/podcast, de-duplication now keys on the episode entity identity plus
  `consumedOn` and `progressPercent` (two events on the same episode entity with
  the same consumed date and percent are duplicates).
- The anime/manga sub-item keys are kept unchanged.

### Legacy bootstrap (in scope; E2E test deferred)

- The previous version's stored show/podcast structural data carries provider
  -native ids for each season and episode. A new migration step — running after
  the parent metadata entities are migrated and before events — explodes that data
  into `show-season`/`show-episode`/`podcast-episode` entities (keyed on the
  native ids, marked populated) and the relationship rows linking them.
- The previous version's watch-history rows carry only positional season/episode
  numbers. The seen and review migrations resolve the episode entity positionally
  (using the same parent + ordering-number logic) and set the event's target
  entity to the episode; per-episode progress and review events are produced.
- The completion backfill continues to emit **entity-level** `complete` events on
  the show/podcast (its existing behavior), not per-season or per-episode.

### Read path and derived state

- The show/podcast detail view is served by the query engine's hierarchical
  include: parent → seasons (ordered by `seasonNumber`) → episodes (ordered by
  `episodeNumber`), with per-episode progress/complete existence selected inline.
  No dedicated endpoint is added.
- "Currently watching" is derived as: a show that has at least one episode with a
  `progress` event and no show-level `complete`. "Fully watched" is derived as:
  the count of completed episodes equals the total episode count. Both are
  expressed with the query engine's existence/aggregate cross-schema filters.
  Specials (season 0) are excluded from the "fully watched" count.
- The builtin "All Shows"/"All Podcasts" views are unaffected (they filter by
  library membership, not by progress). The denormalized `totalEpisodes` count
  keeps the existing podcast count display working.

## Testing Decisions

A good test here asserts externally observable behavior — the entities,
relationships, and events that exist after an operation, and the data the query
engine returns — not internal implementation details. Tests follow the project
convention of inline assertions, extracting shared setup but not test intent, and
they avoid tests that merely prove a library or the type system works (no schema
smoke-parses, no assign-then-assert, no status/shape passthroughs).

Modules and behaviors to test:

- **Episode Resolver (isolation)**: given a populated show/podcast tree, assert
  that correct positional coordinates resolve to the right episode entity, that a
  miss returns null (wrong/absent number), that the podcast single-hop path works,
  and that an ambiguous match resolves deterministically or returns null. This is
  the linchpin every progress source depends on.
- **Child-Entity Tree Processor (isolation)**: given a season/episode tree, assert
  the right entities and relationship rows are created, that re-running is
  idempotent (no duplicates), that the parent's populating script is inherited,
  and that `name` (with fallback) and `image` are set.
- **Show-detail nested include (end-to-end, through the query engine)**: fetch a
  show with seasons → episodes nested and ordered, with per-episode progress
  existence. The existing query-engine end-to-end tests that fetch a
  course → modules → lessons tree (with ordering and per-lesson event existence)
  are the direct prior art and template.
- **Progress resolution (end-to-end)**: an import and a live sink event with
  positional coordinates resolve to the correct episode entity, and an unresolvable
  event is dropped (and logged) rather than mis-attached. Prior art: the existing
  import adapter and sink tests.
- **Completion + derivation (end-to-end)**: an episode auto-completes at 100%
  progress, and "show fully watched" is derivable via a query-engine aggregate
  without a stored show-level rollup. Prior art: existing event/trigger tests and
  query-engine aggregate tests.

Not tested: declarative builtin schema registration (covered implicitly by the
end-to-end tests that rely on the schemas existing), and the legacy-bootstrap
migration end-to-end (the migration code is in scope, but its end-to-end test is
deferred).

## Out of Scope

- Anime and manga sub-entities; their flat tracking is unchanged.
- Any query-engine changes — hierarchical includes, ordering, and cross-schema
  filters are already implemented.
- The new client/frontend rendering of the season/episode tree.
- The previous-version (Rust) backend and its frontend, which are being replaced.
- Hardened podcast-episode resolution (matching on publish date or provider id);
  podcast resolution is best-effort by episode number with drop-on-miss, because
  provider episode numbering is derived and unstable upstream.
- Pruning sub-entities that a provider later drops or renumbers on re-population.
- Storing rolled-up parent (season/show) completion as events; parent "fully
  watched" is derived on read instead. Manual season/show `complete` remains.
- A per-episode `review` event schema (can be added later if wanted).
- Any dedicated endpoint for fetching a show's season/episode tree.
- The legacy-bootstrap migration's end-to-end test (the migration itself is in
  scope).

## Further Notes

- The single largest dependency, hierarchical query-engine includes, is already
  implemented and verified, so the show-detail read path needs no new endpoint and
  no temporary multi-query scaffolding.
- Populate-first ordering is a hard requirement, not an optimization: episode
  progress can only resolve once the parent's tree is populated. The import and
  sink flows already populate the parent before creating events.
- The auto-complete trigger and the progress-policy trigger both branch on entity
  type; only the show/podcast branches change, and the anime/manga branches must
  be left intact.
- Creating a large show's full tree (potentially a few hundred season + episode
  entities and relationship rows) as individually-named workflow activities is
  consistent with the existing related-entity pattern and is acceptable.
- New builtin schemas propagate to all databases automatically (seeding runs
  idempotently on every boot).

---

## Tasks

**Overall Progress:** 2 of 6 tasks completed

**Current Task:** [Task 03](./03-show-live-integrations-to-episodes.md) (todo)

### Task List

| #   | Task                                                                                           | Type | Status |
| --- | ---------------------------------------------------------------------------------------------- | ---- | ------ |
| 01  | [Show episodes: structure, tracking & read](./01-show-episodes-structure-tracking-and-read.md) | AFK  | done   |
| 02  | [Show import history → episodes](./02-show-import-history-to-episodes.md)                      | AFK  | done   |
| 03  | [Show live integrations → episodes](./03-show-live-integrations-to-episodes.md)                | AFK  | todo   |
| 04  | [Podcast episodes end-to-end](./04-podcast-episodes-end-to-end.md)                             | AFK  | todo   |
| 05  | [Legacy data migration → episodes](./05-legacy-data-migration-to-episodes.md)                  | AFK  | todo   |
| 06  | [Codebase cleanup](./06-codebase-cleanup.md)                                                   | AFK  | todo   |
