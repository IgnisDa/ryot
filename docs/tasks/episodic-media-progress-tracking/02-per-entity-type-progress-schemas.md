# Per-Entity-Type Progress Event Schemas

**Parent Plan:** [Episodic Media Progress Tracking](./README.md)

**Type:** AFK

**Status:** done

## What to build

Replace the single shared `progress` event schema with per-entity-type variants. The function that produces lifecycle event schemas is parameterized by entity schema slug and uses `match` from `ts-pattern` to return a schema suited to that media type.

**Show.** The show `progress` schema includes `progressPercent`, `showSeason` (integer), and `showEpisode` (integer). A schema-level coupling rule enforces that `showSeason` is required when `showEpisode` is present and vice versa — mirroring the existing conditional-required rule already used by the `complete` schema's `completedOn` field.

**Anime.** The anime `progress` schema includes `progressPercent` and `animeEpisode` (optional integer).

**Manga.** The manga `progress` schema includes `progressPercent`, `mangaChapter` (optional number, not integer — fractional chapters such as 42.5 must be accepted), and `mangaVolume` (optional integer).

**Podcast.** The podcast `progress` schema includes `progressPercent` and `podcastEpisode` (optional integer).

**All other media types** (movie, book, audiobook, comic book, video game, music, visual novel, person). The `progress` schema is unchanged — `progressPercent` only.

The `complete`, `backlog`, and `review` schemas are the same across all entity types and are not affected.

## Acceptance criteria

- [x] Posting a `progress` event with `showSeason` and `showEpisode` on a show entity succeeds.
- [x] Posting a `progress` event with `showEpisode` but without `showSeason` on a show entity fails validation.
- [x] Posting a `progress` event with `showSeason` but without `showEpisode` on a show entity fails validation.
- [x] Posting a `progress` event with `animeEpisode` on an anime entity succeeds.
- [x] Posting a `progress` event with `mangaChapter: 42.5` and `mangaVolume` on a manga entity succeeds.
- [x] Posting a `progress` event with `podcastEpisode` on a podcast entity succeeds.
- [x] Posting a `progress` event with only `progressPercent` on a movie entity succeeds (regression).
- [x] Posting a `progress` event with `showSeason` and `showEpisode` on a movie entity fails (fields not in schema).
- [x] The show `progress` schema is not the same object reference as the movie `progress` schema (distinct definitions per type).

## User stories addressed

- User story 1 — show episode recorded in progress event
- User story 2 — anime episode recorded in progress event
- User story 3 — manga chapter and volume recorded in progress event
- User story 4 — podcast episode recorded in progress event
