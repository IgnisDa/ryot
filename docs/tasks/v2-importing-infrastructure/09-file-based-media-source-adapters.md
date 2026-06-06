# File-Based Media Source Adapters

**Parent Plan:** [V2 Importing Infrastructure](./README.md)

**Type:** AFK

**Status:** done

## What to build

Port the remaining non-ZIP file-based media source adapters onto the V2 import pipeline: `imdb`, `igdb`, `grouvee`, `anilist`, `myanimelist`, and `watcharr`. These sources should use the import file helpers, normalized media entity-group contract, provider-backed population path, event creation path, and failure persistence already established by earlier slices.

Do not invent fallback whole-entity episodic completion when a source lacks episode/chapter coverage. For episodic imports, emit per-episode/per-chapter `progress(100)` events when coverage exists and let auto-complete derive whole-entity completions.

## Acceptance criteria

- [x] Source input schemas are added for `imdb`, `igdb`, `grouvee`, `anilist`, `myanimelist`, and `watcharr`.
- [x] CSV/JSON reads go through centralized import file helpers with path, extension, and size validation.
- [x] Adapters emit normalized media entity groups and failures without direct DB writes.
- [x] Non-episodic completed facts map to `complete` events with historical `occurredAt` where source dates exist.
- [x] Episodic watched/read coverage maps to `progress(100)` events with required coverage keys and source dates where available.
- [x] The adapters do not create direct whole-entity episodic `complete` events unless a source-specific real fact exists that cannot be represented as coverage.
- [x] Lifecycle aliases map to V2 lifecycle events; non-lifecycle source lists map to collections.
- [x] Adapter tests cover success, malformed rows/items, lifecycle mapping, episodic coverage mapping, review mapping, and collection mapping for each source.
- [x] Import run counters/failures remain consistent across mixed success/failure files.

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 4
- User story 5
- User story 7
- User story 8
- User story 9
- User story 10
- User story 11
- User story 12
- User story 22
- User story 23
