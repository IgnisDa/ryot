# Frontend Episodic Progress Tracking UI

**Parent Plan:** [Episodic Media Progress Tracking](./README.md)

**Type:** AFK

**Status:** done

## What to build

Update the frontend so that users can select an episode, chapter, season, or volume when logging progress for a show, anime, manga, or podcast. This slice depends on Slice 02 (the backend now accepts granular fields on progress events).

### State

Extend `SearchResultRowActionState` with optional granular tracking fields: show season number, show episode number, anime episode number, manga chapter number (supporting decimals), manga volume number, and podcast episode number. Add matching defaults to `defaultSearchResultRowActionState`.

### Payload builders

Update the media-actions module:

- `createProgressEventPayload` passes the relevant granular fields through to the event properties when they are present.
- `createLogEventPayload` is updated for episodic entity schemas: instead of creating a `complete` event, it creates a `progress` event at 100% (or at 1% for "just started") carrying the selected episode or chapter fields. Non-episodic media continues to emit a `complete` event as before.

### Search result log panel

`SearchResultLogPanel` receives two new props: `entitySchemaSlug` (string) and `entityProperties` (the full properties blob from `GET /entities/:entityId`, available after the entity is ensured). When the entity schema is episodic, the panel renders additional selectors above the date-selection controls using existing Mantine components:

- **Show**: A `Select` populated from `properties.showSeasons` for the season, then a second `Select` populated from the chosen season's episodes.
- **Podcast**: A `Select` populated from `properties.episodes`.
- **Anime**: A `NumberInput` for the episode number, bounded by `properties.episodes` when the count is known.
- **Manga**: A `NumberInput` for the chapter (allowing decimals) and an optional `NumberInput` for the volume.

Episode selectors appear only after the entity has been ensured and properties have been fetched. Until then, the panel shows only the date-selection controls. No custom input primitives are introduced — only `Select` and `NumberInput` from Mantine.

### Track progress modal

`ContinueLoggingModalContent` receives `entitySchemaSlug` as a new prop. When the entity schema is episodic, the modal fetches entity properties from `GET /entities/:entityId` using the `entityId` it already holds, then renders the same episode/chapter selectors above the progress-percent input using the same Mantine components.

### Entity schema slug threading

`entitySchemaSlug` is passed as a prop to both `SearchResultLogPanel` and `ContinueLoggingModalContent` from their respective call sites. No internal lookup by schema ID is performed inside these components.

## Acceptance criteria

- [x] Logging a show episode from the search log panel sends a `progress` event with `showSeason` and `showEpisode` populated.
- [x] The season dropdown in the log panel is populated from `properties.showSeasons`.
- [x] Selecting a season updates the episode dropdown to show only that season's episodes.
- [x] Logging a podcast episode from the search log panel sends a `progress` event with `podcastEpisode` populated.
- [x] Logging an anime episode from the search log panel sends a `progress` event with `animeEpisode` populated.
- [x] Logging a manga chapter from the search log panel sends a `progress` event with `mangaChapter` populated (decimal values accepted).
- [x] The log panel shows no episode selectors for non-episodic entity schemas (movie, book, etc.).
- [x] "Just started" for a show episode sends a `progress` event at 1% with `showSeason` and `showEpisode` populated.
- [x] "Just now" / "I don't remember" / "Pick a date" for a show episode sends a `progress` event at 100% with episode fields (not a `complete` event).
- [x] "Just now" for a movie still sends a `complete` event (regression).
- [x] The track progress modal for a show shows season and episode selectors above the percent input.
- [x] The track progress modal for a non-episodic entity shows only the percent input (regression).
- [x] Episode selectors do not appear until the entity is ensured and properties are loaded.
- [x] `entitySchemaSlug` is passed as a prop; no additional API calls to look up the schema by ID are made inside the panel or modal components.

## User stories addressed

- User story 1 — show season and episode in progress event
- User story 2 — anime episode in progress event
- User story 3 — manga chapter and volume in progress event
- User story 4 — podcast episode in progress event
- User story 5 — season and episode dropdown for shows
- User story 6 — episode selector for podcasts
- User story 7 — episode or chapter number input for anime and manga
- User story 8 — granular fields visible in activity history
- User story 15 — "Just started" also requires episode selection
