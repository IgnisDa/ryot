# Episodic Auto-Complete Trigger Rewrite

**Parent Plan:** [Episodic Media Progress Tracking](./README.md)

**Type:** AFK

**Status:** done

## What to build

Rewrite the `auto-complete-on-full-progress` builtin trigger script to implement V1's coverage-based completion logic. The rewrite depends on Slice 01 (entity schema slug in trigger context, event list filter by slug) and Slice 02 (per-type progress schemas that carry episode/chapter fields).

**Non-episodic path (unchanged).** If `entitySchemaSlug` is not one of `show`, `anime`, `manga`, or `podcast`, the script behaves exactly as it does today: create a `complete` event when `progressPercent === 100`.

**Episodic path — coverage check.** For the four episodic types the script:

1. Fetches entity properties via `GET /entities/:entityId` to read the episode or chapter structure stored in the entity.
2. Computes the set of required episode or chapter keys from those properties.
3. Fetches all `progress` events for the entity using `GET /events?entityId=:id&eventSchemaSlug=progress`.
4. Computes the set of covered keys — episode/chapter keys that appear in at least one progress event where `progressPercent === 100`.
5. Creates a `complete` event only if every required key is covered.

**Show.** Required keys are `"{seasonNumber}-{episodeNumber}"` for every episode across all non-special seasons. A season is special if its `name` property is in `["Specials", "Extras"]`. Covered keys are built from progress events carrying both `showSeason` and `showEpisode` at 100%.

**Anime.** Required keys are the strings `"1"` through `"{properties.episodes}"`. If `properties.episodes` is null, absent, or not a positive integer, the episode count is unknown and a `complete` event is created immediately (same as the non-episodic fallback). Covered keys are built from progress events carrying `animeEpisode` at 100%.

**Manga.** Required keys are the chapter numbers `"1"` through `"{properties.chapters}"`. If `properties.chapters` is null, absent, or not a positive number, a `complete` event is created immediately. Covered keys are built from progress events carrying `mangaChapter` at 100%.

**Podcast.** Required keys are the episode numbers from the `properties.episodes` array. If the array is absent or empty, a `complete` event is created immediately. Covered keys are built from progress events carrying `podcastEpisode` at 100%.

The trigger script runs in a sandboxed plain-JavaScript environment. `ts-pattern` is not available; branching uses plain `if` / `else if`.

## Acceptance criteria

- [x] Logging episode S1E1 at 100% on a 2-episode show does not create a `complete` event.
- [x] Logging both S1E1 and S1E2 at 100% on a 2-episode show creates exactly one `complete` event.
- [x] A show with a season named "Specials" (1 episode) and a regular season (1 episode) marks complete after logging only the regular episode.
- [x] Logging all episodes of an anime (with known count) creates a `complete` event.
- [x] Logging one episode of an anime where `properties.episodes` is null creates a `complete` event immediately.
- [x] Logging all chapters of a manga (with known count) creates a `complete` event.
- [x] Logging one chapter of a manga where `properties.chapters` is null creates a `complete` event immediately.
- [x] Logging all episodes of a podcast creates a `complete` event.
- [x] Non-episodic regression: logging 100% on a movie entity still creates a `complete` event immediately.
- [x] Non-episodic regression: logging 100% twice on a movie entity still creates two `complete` events.
- [x] The existing trigger tests for non-episodic behavior pass without modification.

## User stories addressed

- User story 9 — show "complete" only after all episodes logged
- User story 10 — anime "complete" only after all episodes logged
- User story 11 — manga "complete" only after all chapters logged
- User story 12 — podcast "complete" only after all episodes logged
- User story 13 — special seasons excluded from show completion
- User story 14 — unknown episode/chapter count falls back to immediate complete
