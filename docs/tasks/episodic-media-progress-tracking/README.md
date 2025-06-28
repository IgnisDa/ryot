# Episodic Media Progress Tracking

> **Status: Complete** — All 4 tasks finished. This document is a historical reference.

## Problem Statement

Ryot V2 currently treats all progress events as a single percentage number, losing the granular episode, season, chapter, and volume context that was present in V1. When a user logs progress on a show, anime, manga, or podcast, the event only records `progressPercent` — there is no record of which specific episode was watched or which chapter was read.

This creates a second, more serious problem: the auto-complete trigger fires a show-level "complete" event the moment any single episode reaches 100%. A user watching episode 5 of a 10-episode season is told they have finished the show. This is incorrect. V1 only considered a show, anime, manga, or podcast complete when every episode or chapter had been individually tracked.

## Solution

Extend the progress event schema for each episodic entity type (show, anime, manga, podcast) with the granular fields that V1 stored. Each entity type gets its own tailored variant of the `progress` event schema so that only the fields relevant to that type are accepted, and relationships between fields (such as season and episode both being required when either is present) are enforced at the schema level.

Rewrite the auto-complete trigger to implement V1's coverage-based completion logic: a "complete" event is only emitted for episodic media once every known episode or chapter has a corresponding progress event at 100%. Non-episodic media (movies, books, audiobooks, video games, music) retains its existing behavior where 100% progress immediately fires a "complete" event.

Update the frontend to collect and surface the granular fields, so users can select which episode or chapter they are logging, and so the logged events carry meaningful context.

## User Stories

1. As a user watching a show, I want each progress event to record the specific season and episode I watched, so that my activity history reflects exactly what I watched and when.
2. As a user watching anime, I want each progress event to record the specific episode number I watched, so that my tracking history is accurate at the episode level.
3. As a user reading manga, I want each progress event to record the specific chapter (and optionally volume) I read, so that I can track my reading at chapter granularity.
4. As a user listening to a podcast, I want each progress event to record the specific episode I listened to, so that I know exactly which episodes I have covered.
5. As a user watching a show, I want to select a season and episode from a dropdown when logging progress, so that I do not have to type episode identifiers manually.
6. As a user watching a podcast, I want to select an episode from a list when logging progress, so that I can find the episode I watched without knowing its number.
7. As a user watching anime or reading manga, I want a number input for the episode or chapter when logging progress, so that I can quickly enter the number I am on.
8. As a user, I want to see the specific episode or chapter displayed in my activity timeline, so that I can review my watch or read history at a glance.
9. As a user watching a show, I want a "complete" event to be created automatically only after I have logged all episodes, so that my library correctly reflects I finished the show.
10. As a user watching anime, I want a "complete" event to be created automatically only after I have logged every episode, so that partial watches do not incorrectly mark a series as complete.
11. As a user reading manga, I want a "complete" event to be created automatically only after I have logged every chapter, so that finishing one chapter does not mark the full manga as done.
12. As a user listening to a podcast, I want a "complete" event to be created automatically only after I have listened to all episodes, so that partial listens do not mark a podcast as finished.
13. As a user watching a show, I want special seasons such as "Specials" and "Extras" to be excluded from the completion calculation, so that not watching bonus content does not prevent the show from being marked complete.
14. As a user watching anime or reading manga where the total episode or chapter count is unknown, I want logging one episode at 100% to fire a "complete" event immediately, so that I am not stuck in an incomplete state for media without known counts.
15. As a user starting a new show episode, I want the "Just started" log option to also require an episode selection, so that my in-progress tracking is as specific as possible.
16. As a user viewing my activity history, I want episode and chapter information displayed in a readable format rather than raw key-value pairs, so that my timeline is easy to understand at a glance.
17. As a developer writing sandbox trigger scripts, I want the trigger context to include the entity schema slug, so that triggers can branch on media type without an extra API call.
18. As a developer querying events, I want to filter the event list by event schema slug, so that I can fetch only progress or only complete events without fetching all events and filtering client-side.

## Implementation Decisions

### Progress Event Schema — Per-Entity-Type Variants

The `progress` event schema is no longer a single shared definition. The function that produces lifecycle event schemas becomes aware of the entity schema slug and uses `match` from `ts-pattern` to return a schema tailored to each entity type:

- **Show**: `progressPercent` plus `showSeason` (integer) and `showEpisode` (integer). Coupling is enforced through schema rules: `showSeason` is required when `showEpisode` is present, and vice versa.
- **Anime**: `progressPercent` plus `animeEpisode` (optional integer).
- **Manga**: `progressPercent` plus `mangaChapter` (optional number, supporting decimals such as 42.5) and `mangaVolume` (optional integer).
- **Podcast**: `progressPercent` plus `podcastEpisode` (optional integer).
- **All other media** (movie, book, audiobook, comic book, video game, music, visual novel): `progressPercent` only, unchanged from the current behavior.

The `complete` event schema is unchanged. It continues to represent completion of the entire media item and carries no episode or chapter fields.

### Event List Filter — `eventSchemaSlug`

An optional `eventSchemaSlug` query parameter is added to the list-events endpoint. When provided, only events whose event schema slug matches the parameter are returned. The trigger script uses this to fetch only progress events for an entity, avoiding full event list retrieval.

### Trigger Context — `entitySchemaSlug`

The trigger execution context is extended to include `entitySchemaSlug` alongside the existing `entitySchemaId`. This allows trigger scripts to branch on media type using a stable, readable slug without performing an additional API lookup.

### Auto-Complete Trigger — V1 Coverage Logic

The `auto-complete-on-full-progress` builtin trigger script is fully rewritten. Its logic is:

1. If `progressPercent` is not 100, return immediately (unchanged).
2. Read `entitySchemaSlug` from the trigger context.
3. If the entity schema is one of `show`, `anime`, `manga`, or `podcast`, enter coverage mode:
   a. Fetch the entity's properties via `GET /entities/:entityId` to read the episode or chapter structure.
   b. Fetch all progress events for the entity filtered by `eventSchemaSlug=progress` via `GET /events`.
   c. Compute the set of required episode or chapter keys from entity properties.
   d. Compute the set of covered keys from all progress events that have `progressPercent` equal to 100.
   e. Only proceed to create a "complete" event if every required key is covered.
4. For non-episodic entity schemas, create the "complete" event immediately (existing behavior).

**Show coverage**: Required keys are `"{seasonNumber}-{episodeNumber}"` for every episode across all seasons. Seasons whose name appears in `["Specials", "Extras"]` are excluded. Covered keys are built from progress events carrying `showSeason` and `showEpisode` at `progressPercent === 100`.

**Anime coverage**: Required keys are the strings `"1"` through `"{totalEpisodes}"`. If `properties.episodes` is null or absent, the total is unknown and a "complete" event is fired immediately (same as V1 fallback). Covered keys are built from progress events carrying `animeEpisode` at 100%.

**Manga coverage**: Required keys are chapter numbers from `"1"` through `"{totalChapters}"`. If `properties.chapters` is null or absent, a "complete" event is fired immediately. Covered keys are built from progress events carrying `mangaChapter` at 100%.

**Podcast coverage**: Required keys are the episode numbers from `properties.episodes` array. If the array is absent or empty, fire immediately. Covered keys are built from progress events carrying `podcastEpisode` at 100%.

### Frontend — State and Payload Builders

`SearchResultRowActionState` gains additional fields for each episodic dimension: show season number, show episode number, anime episode number, manga chapter number, manga volume number, and podcast episode number. These are optional and carry either a numeric value or an empty string.

The payload builder functions in the media-actions module are updated:

- `createProgressEventPayload` accepts the relevant granular fields and includes them in the event properties when present.
- `createLogEventPayload` is updated for episodic entity schemas: instead of creating a `complete` event, it creates a `progress` event at 100% (or at 1% for "just started") carrying the selected episode or chapter fields. Non-episodic media continues to emit a `complete` event.

### Frontend — Episode Selectors

The `SearchResultLogPanel` is extended to accept `entitySchemaSlug` and `entityProperties` as props. When the entity schema is episodic, appropriate selectors appear after the entity has been ensured:

- **Show**: A `Select` for season (populated from `properties.showSeasons`) followed by a `Select` for episode (populated from the chosen season's episodes).
- **Podcast**: A `Select` for episode (populated from `properties.episodes`).
- **Anime**: A `NumberInput` for episode number, bounded by `properties.episodes` when available.
- **Manga**: A `NumberInput` for chapter (supporting decimals) and an optional `NumberInput` for volume.

Existing Mantine components (`Select`, `NumberInput`) are used directly; no new primitive components are introduced.

Episode selectors appear only after the entity is ensured, because entity properties are fetched via `GET /entities/:entityId` using the ensured entity's ID. Until then the panel shows only the date selection controls.

### Frontend — Track Progress Modal

`ContinueLoggingModalContent` is extended to accept `entitySchemaSlug` as a prop. When rendered for an episodic entity, it fetches entity properties from `GET /entities/:entityId` and renders the same episode/chapter selectors above the progress percent input. The selectors use the same Mantine components and the same pattern as the log panel.

### Frontend — entitySchemaSlug as Prop

Both `SearchResultLogPanel` and `ContinueLoggingModalContent` receive `entitySchemaSlug` as a prop from their call sites, which already have this information. No internal schema lookups by ID are performed.

## Testing Decisions

Good tests for this feature assert observable behavior at the API and trigger boundary. They do not test internal helper structure, property-parsing helpers in isolation, or schema shape directly. Every test should exercise a meaningful behavioral branch.

### List Events Filter

The events integration test suite gains tests for the `eventSchemaSlug` query parameter. Tests should verify that filtering by `slug=progress` returns only progress events, filtering by `slug=complete` returns only complete events, and an unrecognized slug returns an empty list rather than an error. Prior art: the existing events bulk POST tests in `tests/src/tests/events.test.ts`.

### Auto-Complete Trigger — Episodic Coverage

The event-triggers integration test suite gains new test cases. Each episodic type is tested with a seeded entity whose properties contain a known episode or chapter structure:

- **Show — partial completion**: Logging episode S1E1 at 100% does not fire a "complete" event when S1E2 and S1E3 also exist.
- **Show — full completion**: Logging all episodes of a show fires exactly one "complete" event.
- **Show — specials excluded**: A show with one regular episode and one season named "Specials" fires "complete" after logging only the regular episode.
- **Anime — full completion**: Logging all episodes of an anime fires "complete".
- **Anime — unknown count**: An anime with `properties.episodes = null` fires "complete" on any episode logged at 100%.
- **Manga — full completion**: Logging all chapters fires "complete".
- **Podcast — full completion**: Logging all podcast episodes fires "complete".
- **Non-episodic regression**: The existing behavior (100% → immediate "complete") is preserved for entity schemas without episodic fields.

Fixtures for seeding show, anime, manga, and podcast entities with structured properties should be added to `tests/src/fixtures/media.ts` using the existing `seedMediaEntity` helper. Prior art: `createBuiltinMediaLifecycleFixture` and the polling helpers in `tests/src/fixtures/`.

### Backend Unit Tests

The events service module should have a unit test verifying that `entitySchemaSlug` appears in the trigger context emitted by `processEventSchemaTriggers`. Prior art: the existing service-level tests in `apps/app-backend/src/modules/events/`.

## Out of Scope

- Data migration or backwards compatibility for existing events that lack episode or chapter fields.
- Changes to the activity timeline display in the entity detail page (`EntityDetailEventTimeline`).
- Episode or chapter tracking for non-episodic media (movie, book, audiobook, comic book, video game, music, visual novel).
- Reporting or aggregation of per-episode coverage (e.g., "you have watched 7 of 10 episodes").
- Any changes to how the `complete` event schema is defined or validated.

## Further Notes

- The trigger script executes in a sandboxed JavaScript environment. The `match` function from `ts-pattern` is not available there. Branching inside the trigger script uses plain `if` / `else if` chains.
- The `GET /entities/:entityId` endpoint already returns the full `properties` blob and is accessible from sandbox scripts via `appApiCall`. No new endpoint is needed.
- The `SeenShowExtraInformation`, `SeenAnimeExtraInformation`, `SeenMangaExtraInformation`, and `SeenPodcastExtraInformation` types in V1 serve as the authoritative reference for which fields each media type tracks.
- Special season names `["Specials", "Extras"]` are taken directly from the V1 constant `SHOW_SPECIAL_SEASON_NAMES` in `crates/utils/common/src/lib.rs`.
- The `mangaChapter` field must be a `number` (not integer) to support fractional chapter numbers such as 42.5, mirroring V1's `Decimal` type.

---

## Tasks

**Overall Progress:** 4 of 4 tasks completed

**Current Task:** [Task 04](./04-frontend-episodic-progress-tracking-ui.md) (done)

### Task List

| #   | Task                                                                                             | Type | Status |
| --- | ------------------------------------------------------------------------------------------------ | ---- | ------ |
| 01  | [Event Infrastructure Prerequisites](./01-event-infrastructure-prerequisites.md)                | AFK  | done   |
| 02  | [Per-Entity-Type Progress Event Schemas](./02-per-entity-type-progress-schemas.md)               | AFK  | done   |
| 03  | [Episodic Auto-Complete Trigger Rewrite](./03-episodic-auto-complete-trigger-rewrite.md)         | AFK  | done   |
| 04  | [Frontend Episodic Progress Tracking UI](./04-frontend-episodic-progress-tracking-ui.md)         | AFK  | done   |
