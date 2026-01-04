# Episodic Sub-Entity Model Rewrite

## Problem

Shows and podcasts store their internal structure as nested JSONB arrays inside
the parent entity's `properties` column. `ShowPropertiesSchema` has a
`showSeasons` field containing an array of season objects, each of which
contains an `episodes` array. `PodcastPropertiesSchema` has a top-level
`episodes` array.

This design has four concrete problems.

**No stable identity.** Seasons and episodes are array elements in a blob. They
have no `id`, cannot be referenced by other parts of the system, and cannot be
the target of a relationship.

**Progress events carry positional noise.** Tracking "watched episode 4 of
season 2" requires storing `{ showSeason: 2, showEpisode: 4 }` in the event's
`properties` JSONB. This is a free-form encoding the system cannot validate,
index, or traverse structurally. The event points at the _show_ entity, not the
episode, so answering "which episodes have I watched?" requires a JSONB scan.

**Query engine cannot address sub-units.** Because episodes have no entity
identity, the query engine cannot filter, sort, or aggregate across them as
first-class rows. Cross-episode queries require bespoke JSONB path operators
outside the normal query language.

**No per-sub-unit relationships.** An individual episode or season cannot carry
its own relationships (guest appearances, directors, etc.).

Anime and manga are explicitly out of scope for this problem. Their tracking is
flat by design — they store only a total episode/chapter count, and progress
events carry a bare episode or chapter number. There is no per-episode metadata
to promote to a first-class entity.

---

## Solution

Promote `show-season`, `show-episode`, and `podcast-episode` to first-class
entity schemas. Link them to their parents with builtin relationship schemas.
Remove the nested JSONB arrays from the parent entity schemas.

### Hierarchy

Shows use a two-level hierarchy:

```txt
show ──(show-season)──► show-season ──(season-episode)──► show-episode
```

Podcasts use a single level:

```txt
podcast ──(podcast-episode)──► podcast-episode
```

Relationships are outgoing from the parent. Both hops for shows are separate
builtin relationship schemas.

### Ordering

Ordering is stored on the entity itself, not on the relationship. Position is a
property of the child, not a property of membership.

| Entity            | Ordering field  | Type              |
| ----------------- | --------------- | ----------------- |
| `show-season`     | `seasonNumber`  | integer, required |
| `show-episode`    | `episodeNumber` | integer, required |
| `podcast-episode` | `episodeNumber` | integer, required |

---

## Data Model

### New Builtin Entity Schemas

**`show-season`**

`entity.name` holds the season name. `entity.image` holds the season poster.

| Property       | Type    | Required |
| -------------- | ------- | -------- |
| `seasonNumber` | integer | yes      |
| `description`  | string  | no       |
| `releaseDate`  | date    | no       |

**`show-episode`**

`entity.name` holds the episode title. `entity.image` holds the episode still.

| Property        | Type              | Required |
| --------------- | ----------------- | -------- |
| `episodeNumber` | integer           | yes      |
| `runtime`       | integer (minutes) | no       |
| `publishDate`   | date              | no       |
| `description`   | string            | no       |

**`podcast-episode`**

`entity.name` holds the episode title. `entity.image` holds the episode
artwork.

| Property        | Type              | Required |
| --------------- | ----------------- | -------- |
| `episodeNumber` | integer           | yes      |
| `runtime`       | integer (minutes) | no       |
| `publishDate`   | date              | no       |
| `description`   | string            | no       |

### New Builtin Relationship Schemas

| Slug              | Source        | Target            |
| ----------------- | ------------- | ----------------- |
| `show-season`     | `show`        | `show-season`     |
| `season-episode`  | `show-season` | `show-episode`    |
| `podcast-episode` | `podcast`     | `podcast-episode` |

No custom properties are needed on any of these relationships.

### Modified Parent Schemas

`ShowPropertiesSchema` loses `showSeasons`. All standard media base fields
(`description`, `genres`, `publishYear`, `isNsfw`, `sourceUrl`,
`providerRating`, `productionStatus`, `images`) remain.

`PodcastPropertiesSchema` loses `episodes` and `totalEpisodes`. The remaining
fields (`description`, `genres`, `publishYear`, `isNsfw`, `sourceUrl`,
`providerRating`, `productionStatus`, `images`, `unlinkedCreators`) remain.

Whether to keep denormalized `totalSeasons` and `totalEpisodes` counts on the
`show` entity (to avoid a relationship traversal for top-level display counts)
is left to the implementing agent.

---

## Event Schema Changes

### Show

`show` retains: `backlog`, `complete`, `dropped`, `on_hold`, `review`.

`show` loses: `progress`. A show-level progress percentage is meaningless once
tracking is at episode granularity.

`show-season` gets: `complete` (finished an entire season).

`show-episode` gets: `progress` (watched this episode, with `progressPercent`
and `consumedOn`). The episode-level `review` event schema is also reasonable
here if needed.

### Podcast

`podcast` retains: `backlog`, `complete`, `dropped`, `on_hold`, `review`.

`podcast-episode` gets: `progress` (listened to this episode).

### Integration progress-policy deduplication

`apps/app-backend/src/lib/sandbox/triggers/integration-progress-policy.txt`
currently lists `showSeason`, `showEpisode`, and `podcastEpisode` in
`SUBITEM_KEYS`. These keys are removed. Deduplication for show and podcast
progress events now works naturally through the episode entity's identity:
two events pointing at the same episode entity with the same `progressPercent`
and `consumedOn` are duplicates by the existing logic. `animeEpisode`,
`mangaChapter`, and `mangaVolume` remain in `SUBITEM_KEYS` unchanged.

---

## Population Pipeline

Sandbox scripts for shows and podcasts currently return nested season and
episode data inside `properties.showSeasons` and `properties.episodes`. This
must change because the population workflow is now responsible for creating
child entities and relationship rows.

The exact output format from the script is left to the implementing agent.
Whatever format is chosen, the population workflow must:

- Create each season and episode as a separate global entity.
- Create the corresponding relationship rows linking parent to child.
- Ensure re-population is idempotent using stable `externalId` values per
  sub-entity.

For `externalId`, use the provider's native sub-entity ID where one exists
(TMDB has its own season and episode IDs). For providers that do not expose
sub-entity IDs, a synthetic composite is acceptable — for example
`{showExternalId}-s{seasonNumber}` for seasons and
`{showExternalId}-s{seasonNumber}e{episodeNumber}` for episodes.

---

## Import Adapter Changes

Import adapters that currently create show or podcast progress events with
`showSeason`, `showEpisode`, or `podcastEpisode` in `event.properties` must
be updated. Each such event should instead resolve or create the episode entity
and set `event.entityId` to that entity's id.

Known adapters to update:

- `src/modules/imports/sources/anilist/adapter.ts`
- `src/modules/imports/sources/myanimelist/adapter.ts`
- Any other show/podcast import sources

---

## Query Engine Dependency

The query engine currently supports only single-hop relationship traversal and
returns flat results. Fetching a show with all its seasons and episodes nested
correctly requires hierarchical include support, which is covered by a separate
plan (`query-engine-hierarchical-results.md`).

During the gap between this rewrite and the query engine upgrade, the
implementing agent may introduce temporary multi-query patterns in service
layer code to serve the show detail use case. These are explicitly temporary
and must be removed once the query engine gains include support. No permanent
dedicated endpoints should be added.

---

## Scope

- `apps/app-backend/src/lib/builtins/entity-schemas.ts`
- `apps/app-backend/src/lib/builtins/media-property-schemas.ts`
- `apps/app-backend/src/lib/schema/media-types.ts`
- `apps/app-backend/src/modules/entities/population.ts`
- `apps/app-backend/src/lib/sandbox/providers/media/show/` (script output format)
- `apps/app-backend/src/lib/sandbox/providers/media/podcast/` (script output format)
- `apps/app-backend/src/lib/sandbox/triggers/integration-progress-policy.txt`
- `apps/app-backend/src/modules/imports/sources/` (show and podcast adapters)
- `tests/`

## Out of Scope

- Anime and manga sub-entities.
- Query engine hierarchical include support (separate plan).
- Any permanent dedicated endpoint for fetching a show's season/episode tree.
