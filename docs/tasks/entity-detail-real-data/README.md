## Problem Statement

The entity detail page is still powered by fake client-side data and a demo type switcher. That makes the route disconnected from the actual backend entity model, hides the real API contract, and blocks the page from showing live data for the built-in media types that already exist in the product.

We need the page to render real entity details for every built-in media type currently represented in the client demo data. Direct entity fields should come from `GET /entities/{entityId}`. Related data that is not embedded on the entity row, especially cast and crew and collection membership, should come from `POST /query-engine/execute` using relationship joins. The page must keep the current screen sections, but every visible value should be backed by live backend data.

## Solution

Replace the fake entity detail dataset with a real data-loading flow driven by the route `entityId`.

The page should first load the entity row, then resolve the entity schema slug from the returned `entitySchemaId`, and then load relationship-backed data. Direct properties on the entity stay sourced from `GET /entities/{entityId}`. Related people and related collections stay sourced from the query engine in entity mode, using the entity schema slug to choose the correct relationship schema.

The UI should keep the existing structure: hero, about, people, type-specific section, details, and collections. The people list should remain a single combined list, not split into separate cast and crew sections. The type-switching FAB should be removed entirely.

## User Stories

1. As a user opening an entity page, I want to see the real title, image, description, year, rating, and other entity fields, so that the page reflects the selected item instead of demo content.
2. As a user opening a book page, I want to see pages, compilation status, and creator information from the backend, so that the page matches the actual stored entity.
3. As a user opening a movie or show page, I want to see the real people connected to that media item, so that cast and crew are backed by live relationship data.
4. As a user opening any supported media page, I want the page to resolve the correct type-specific layout automatically, so that I do not need to switch demo types.
5. As a user, I want one combined people list instead of separate cast and crew buckets, so that the page stays simple while still showing every related person.
6. As a user, I want the people list to include everyone associated with the entity, so that I can browse the full set of related people without paging controls.
7. As a user, I want collection membership to show all collections for the entity, so that I can understand how the item is organized.
8. As a user, I want the page to support all currently mocked media types, so that every existing demo screen has a real backend-backed equivalent.
9. As a user, I want show seasons and episodes to come from the backend, so that the episode list is accurate.
10. As a user, I want anime airing schedules to come from the backend, so that release timing is current and specific.
11. As a user, I want podcast episode lists to come from the backend, so that episode titles and dates are real.
12. As a user, I want video game time-to-beat and platform release data to come from the backend, so that the game detail page is useful.
13. As a user, I want music duration and various-artist status to come from the backend, so that album pages show the correct metadata.
14. As a user, I want manga chapter and volume counts to come from the backend, so that the page can show the real publishing footprint.
15. As a user, I want the page to keep working even when a related-data section is empty, so that I can still view the core entity details.
16. As a user, I want the page to load without a fake media-type selector, so that the route feels like a real detail page instead of a demo harness.
17. As a user, I want creator labels like author, director, host, or creator to remain readable, so that the page preserves the current presentation quality.
18. As a user, I want the page to show live backend data without extra manual toggles, so that the route can be shared and opened directly.
19. As a user, I want the page to preserve the current hero/detail layout, so that the refactor does not introduce a jarring redesign.
20. As a user, I want any related people or collection data to load automatically behind the scenes, so that I do not have to understand the backend query shape.

## Implementation Decisions

- The feature is client-orchestrated. No new backend composer endpoint will be added for this PRD.
- The page will use `GET /entities/{entityId}` as the source of truth for direct entity fields and the entity `properties` payload.
- The page will use `GET /entity-schemas/{entitySchemaId}` to resolve the entity schema slug, because the entity detail response only exposes `entitySchemaId`.
- The page will use `POST /query-engine/execute` in entity mode for relationship-backed data.
- The query engine will be used to fetch related people for media types whose creator data is relationship-backed, especially movie and show.
- The query engine will be used to fetch related collections for every supported media type, because collections are not embedded on the entity row.
- Related people must be fetched as real related entity rows, not as a nested array on the media row. The UI can then render them as a combined list.
- The people section remains a single combined list. It will not be split into separate cast and crew sections.
- The page should keep the current creator labeling behavior, but the backing source can differ by media type. Direct creator metadata stays direct when it already exists on the entity payload; relationship-backed people are used when the entity does not carry that data directly.
- The people list should normalize creator rows into one display model so the section can render both direct creator metadata and relationship-backed people consistently.
- The people list should preserve a stable order based on backend data and any available relationship ordering fields.
- The client loader should fetch related query-engine pages until the result set is exhausted. There should be no visible pagination UI for people or collections.
- The entity page should support all built-in media types currently represented in the fake data: book, movie, show, anime, manga, comic-book, audiobook, podcast, music, video-game, and visual-novel.
- The type-specific section should continue to show the same kinds of data as the demo screen, just driven by backend values instead of mock objects.
- The type-switcher FAB is removed. The route should always render the actual entity requested by `entityId`.
- The page should fail the main entity load if the entity or entity-schema lookup fails. Relationship-backed sections should fail independently and fall back to empty or hidden sections instead of forcing fake content.
- No backend schema changes are expected for this PRD. The current entity, entity-schema, and query-engine contracts are sufficient.

### Section mapping

- Hero and about sections read from the direct entity payload.
- Details rows read from the direct entity payload and the resolved creator model.
- `CreatorsSection` reads from the resolved creator model and remains a combined list.
- `CollectionsSection` reads from the collections relationship query.
- `TypeSpecificSection` reads from the direct entity payload for the active media type.

### Query shapes

- Related people query: use the media type's person relationship schema, `direction: "outgoing"`, `targetEntityId: entityId`, and entity mode with `scope: ["person"]`.
- Related collections query: use `relationshipSchemaSlug: "member-of"`, `direction: "incoming"`, `sourceEntityId: entityId`, and entity mode with `scope: ["collection"]`.
- People and collections queries should request the fields needed by the current UI only.

## Testing Decisions

- Tests should verify rendered behavior, not internal fetch implementation details.
- The entity detail screen should be tested with mocked API responses for the entity, entity schema, people query, and collections query.
- Tests should cover each supported media type and confirm the correct type-specific section is rendered from live data.
- Tests should cover the combined people list and confirm that the page no longer expects separate cast and crew sections.
- Tests should cover the collections section and confirm that every returned related row is rendered.
- Tests should cover the internal paging loop for related query-engine data, so the UI can fetch all rows without exposing pagination controls.
- Tests should cover the removal of the type-switcher FAB.
- Tests should cover loading and error states for the entity fetch and the relationship-backed sections.
- Prior art for test shape should follow the existing app-client and query-engine integration tests that assert visible output from mocked backend responses.

## Out of Scope

- Adding a backend endpoint that composes entity, schema, people, and collection data into one response.
- Changing query-engine semantics to return nested arrays of related entities on the media row.
- Adding visible pagination controls for people or collections.
- Splitting the people section into separate cast and crew sections.
- Making the hero action buttons functional if they are not already wired elsewhere.
- Adding progress-state or completion-state logic beyond the existing page layout.
- Supporting custom entity schemas in this media detail page.
- Redesigning the page beyond replacing fake data and removing the demo-only switcher.

## Further Notes

- `GET /entities/{entityId}` does not provide the entity schema slug, so the entity-schema lookup is required for relationship query routing.
- The backend already seeds the person-to-media relationship schemas and the `member-of` relationship schema, so the client can use existing APIs without backend work.
- The related-people data should be rendered with readable role labels, using the stored role values from the backend.
- The route should remain shareable and directly usable by `entityId` alone.

---

## Tasks

**Overall Progress:** 4 of 4 tasks completed

**Current Task:** [Task 04](./04-codebase-cleanup.md) (done)

### Task List

| #   | Task                                                                                   | Type | Status |
| --- | -------------------------------------------------------------------------------------- | ---- | ------ |
| 01  | [Real Entity Route And Direct Sections](./01-real-entity-route-and-direct-sections.md) | AFK  | done   |
| 02  | [Combined People List](./02-combined-people-list.md)                                   | AFK  | done   |
| 03  | [Collections Section](./03-collections-section.md)                                     | AFK  | done   |
| 04  | [Codebase Cleanup](./04-codebase-cleanup.md)                                           | AFK  | done   |
