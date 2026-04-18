# Media Entity UI Data Handoff

## Purpose

This document describes the media entity data available for UI/UX design. It is a data reference, not a proposed interface or information hierarchy.

## Scope

This handoff covers:

- The 23 supported media entity types.
- Catalog properties that may describe each entity.
- Personal lifecycle events that may be attached to each entity.
- Hierarchy, credit, group, library, and collection relationships.
- Data constraints that affect valid presentation.

It intentionally does not prescribe UI structure, component choices, content priority, or visual direction.

## Entity Envelope

Every entity has:

| Field               | Shape                         | Meaning                                         |
| ------------------- | ----------------------------- | ----------------------------------------------- |
| `id`                | String identifier             | Internal entity identifier.                     |
| `name`              | String                        | Display name or title.                          |
| `entitySchemaSlug`  | String                        | Identifies the entity type.                     |
| `properties`        | Schema-dependent object       | Catalog data described below.                   |
| `createdAt`         | Timestamp string              | When the entity was created.                    |
| `updatedAt`         | Timestamp string              | When the entity was last updated.               |
| `providerId`        | String or null                | Provider responsible for external catalog data. |
| `externalId`        | String or null                | Identifier used by that provider.               |
| `populatedAt`       | Timestamp string or null      | When provider data was last populated.          |
| `translationStatus` | `pending`, `ready`, or `none` | State of translated provider data.              |

`providerId` and `externalId` describe provenance. They are not human-readable provider metadata by themselves.

## Shared Media Properties

The following properties can exist on all 11 primary media schemas:

| Property           | Shape                        | Meaning                                                                                  |
| ------------------ | ---------------------------- | ---------------------------------------------------------------------------------------- |
| `description`      | Translatable string          | Provider synopsis or overview.                                                           |
| `images`           | Translatable array of assets | Cover, promotional, or related images.                                                   |
| `genres`           | Array of strings             | Provider genre labels.                                                                   |
| `publishDate`      | String                       | Exact release date, intended as `YYYY-MM-DD`.                                            |
| `publishYear`      | Integer                      | Release or publication year.                                                             |
| `productionStatus` | String                       | Provider status such as continuing, ended, or cancelled.                                 |
| `providerRating`   | Number                       | Aggregate score supplied by the provider. No universal scale is declared by this schema. |
| `isNsfw`           | Boolean                      | Whether the provider marks the media as adult or not safe for work.                      |
| `sourceUrl`        | String                       | Link to the original source or provider page.                                            |

These fields are not declared as required. An entity can contain only a subset.

### Image Assets

Each image asset can contain:

| Field  | Shape                      | Meaning               |
| ------ | -------------------------- | --------------------- |
| `type` | `remote`, `local`, or `s3` | Storage source.       |
| `url`  | String                     | Asset URL.            |
| `key`  | String                     | Optional storage key. |

The data does not assign semantic roles such as poster, backdrop, thumbnail, profile photo, or logo to individual images. Ordering may be meaningful, but no role is guaranteed.

## Primary Media Differences

All types in this table also have the shared media properties.

| Schema slug    | Type-specific properties                                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `movie`        | `runtime`: integer minutes.                                                                                                                                                                                           |
| `show`         | `totalSeasons`: integer; `totalEpisodes`: integer.                                                                                                                                                                    |
| `anime`        | `episodes`: integer; `airingSchedule`: ordered items containing required episode integer and required airing datetime.                                                                                                |
| `book`         | `pages`: integer; `isCompilation`: boolean; `unlinkedCreators`: name and role pairs.                                                                                                                                  |
| `comic-book`   | `pages`: integer.                                                                                                                                                                                                     |
| `manga`        | `volumes`: integer; `chapters`: number, allowing fractional chapter values.                                                                                                                                           |
| `audiobook`    | `runtime`: integer minutes; `unlinkedCreators`: name and role pairs.                                                                                                                                                  |
| `podcast`      | `totalEpisodes`: integer; `unlinkedCreators`: name and role pairs.                                                                                                                                                    |
| `music`        | `duration`: integer seconds; `byVariousArtists`: boolean.                                                                                                                                                             |
| `video-game`   | `timeToBeat`: optional `hastily`, `normally`, and `completely` integer values; `platformReleases`: platform name plus optional release date and release region. The time unit is not declared in the property schema. |
| `visual-novel` | `lengthMinutes`: integer minutes.                                                                                                                                                                                     |

`unlinkedCreators` are provider-supplied creator names and roles that are not backed by person relationships. They can coexist with linked person credits.

## Episodic Entities

### Show Season

Schema slug: `show-season`.

| Property               | Shape                       | Meaning                                                  |
| ---------------------- | --------------------------- | -------------------------------------------------------- |
| `seasonNumber`         | Required integer, minimum 0 | Position within the show. Zero is reserved for specials. |
| `description`          | Translatable string         | Season overview.                                         |
| `images`               | Translatable asset array    | Cover or promotional images.                             |
| `releaseDate`          | String                      | Season release date.                                     |
| `parentShowExternalId` | String                      | Provider identifier of the parent show.                  |

A `show-to-show-season` relationship also connects the season to its internal parent show.

### Show Episode

Schema slug: `show-episode`.

| Property               | Shape                       | Meaning                                 |
| ---------------------- | --------------------------- | --------------------------------------- |
| `seasonNumber`         | Required integer, minimum 0 | Parent season number.                   |
| `episodeNumber`        | Required integer, minimum 0 | Position within the season.             |
| `description`          | Translatable string         | Episode overview.                       |
| `images`               | Translatable asset array    | Cover or promotional images.            |
| `publishDate`          | String                      | Episode air date.                       |
| `runtime`              | Integer                     | Runtime in minutes.                     |
| `parentShowExternalId` | String                      | Provider identifier of the parent show. |

A `show-season-to-show-episode` relationship connects the episode to its internal season.

### Podcast Episode

Schema slug: `podcast-episode`.

| Property                  | Shape                       | Meaning                                    |
| ------------------------- | --------------------------- | ------------------------------------------ |
| `episodeNumber`           | Required integer, minimum 0 | Position within the podcast.               |
| `description`             | Translatable string         | Episode overview.                          |
| `images`                  | Translatable asset array    | Cover or promotional images.               |
| `publishDate`             | String                      | Episode publication date.                  |
| `runtime`                 | Integer                     | Runtime in minutes.                        |
| `parentPodcastExternalId` | String                      | Provider identifier of the parent podcast. |

A `podcast-to-podcast-episode` relationship also connects the episode to its internal parent podcast.

## Contributors

Contributors are independent entities and can also appear through credit relationships.

### Person

Schema slug: `person`.

Available properties:

- Translatable description or biography.
- Images.
- Birth date and death date.
- Birth place and gender.
- Official website and provider source URL.
- Alternate names as an array of strings.

### Company

Schema slug: `company`.

Available properties:

- Translatable description or overview.
- Images.
- Founded year and headquarters.
- Official website and provider source URL.
- Alternate names as an array of strings.

### Credit Data

A person or company can have a separate credit relationship to each primary media entity.

| Relationship property | Shape            | Meaning                                                                              |
| --------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| `order`               | Number           | Provider display order for the credit.                                               |
| `roles`               | Array of strings | One or more roles, such as director, actor, writer, studio, developer, or publisher. |
| `character`           | String           | Character played by a person. Not available on company credits.                      |

People and companies can also have credits on music groups and video-game groups. A contributor can hold multiple roles for the same entity.

## Media Groups

The six group schemas are:

- `movie-group`: Movie Collection.
- `audiobook-group`: Audiobook Series.
- `book-group`: Book Series.
- `comic-book-group`: Comic Book Series.
- `music-group`: Music Album.
- `video-game-group`: Video Game Collection.

Every group can have:

- A translatable description.
- Images.
- `parts`, an integer count of items in the group.
- A provider source URL.

Each group-to-media membership can contain:

| Property | Shape            | Meaning                                                |
| -------- | ---------------- | ------------------------------------------------------ |
| `order`  | Number           | One-based position of the media item within the group. |
| `roles`  | Array of strings | Roles the group fills for the member item.             |

Groups are independent entities. Their member media are related entities rather than embedded property values.

## Library

Schema slug: `library`.

The library has no catalog properties or lifecycle events. Other entities can relate to it through `in-library` and `media-monitoring` relationships.

An `in-library` relationship can contain:

| Property            | Shape            | Meaning                                          |
| ------------------- | ---------------- | ------------------------------------------------ |
| `owned`             | Boolean          | Whether the user owns the item.                  |
| `ownershipSources`  | Array of strings | Integrations or sources that reported ownership. |
| `ownershipSyncedAt` | Datetime         | Last ownership synchronization time.             |

The `media-monitoring` relationship has no properties. It represents monitoring membership, not live page-update subscriptions.

## Collections

Any entity can be a member of a user collection through a `member-of` relationship.

A collection has an ID, name, optional description, and an optional collection-specific schema for membership properties. Consequently, collection membership properties may differ between collections.

## Personal Lifecycle Events

Events are time-ordered records attached to an entity. Every event record can contain:

- Event ID and event schema slug.
- Entity ID.
- Occurrence, creation, and update timestamps.
- Event-specific properties.
- An optional session entity ID.

The presence of multiple events means history is not inherently a single current-state object.

### Event Shapes

| Event      | Properties                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backlog`  | No properties.                                                                                                                                                      |
| `progress` | Required `progressPercent`, greater than 0 and at most 100; optional `consumedOn`. Anime can add `animeEpisode`. Manga can add `mangaVolume` and `mangaChapter`.    |
| `review`   | Optional `text`, `isSpoiler`, and `rating`. Rating is constrained from 0 through 100. Anime can add `animeEpisode`. Manga can add `mangaVolume` and `mangaChapter`. |
| `dropped`  | Progress properties plus optional `startedOn` and non-negative `timeSpent` in minutes.                                                                              |
| `on_hold`  | Progress properties plus optional `startedOn` and non-negative `timeSpent` in minutes.                                                                              |
| `complete` | Required `completionMode`; optional `consumedOn`, `timeSpent`, `startedOn`, and `completedOn`. `completedOn` becomes required when mode is `custom_timestamps`.     |

`completionMode` is one of `just_now`, `unknown`, or `custom_timestamps`.

### Event Applicability

| Entity schemas                                                                    | Supported events                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Book, comic book, anime, movie, manga, audiobook, video game, music, visual novel | Backlog, progress, review, dropped, on hold, complete. |
| Show, podcast                                                                     | Backlog, review, dropped, on hold, complete.           |
| Show episode, podcast episode                                                     | Progress, review, complete.                            |
| Show season                                                                       | Complete.                                              |
| Person, company, all six media groups                                             | Review.                                                |
| Library                                                                           | None.                                                  |

Shows and podcasts do not support parent-level progress events. Their episode entities carry progress and completion data.

## Relationship Summary

| Relationship          | Direction                    | Relationship data                                                        |
| --------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| Show hierarchy        | Show to season to episode    | No relationship properties; numbering and details are entity properties. |
| Podcast hierarchy     | Podcast to episode           | No relationship properties; numbering and details are entity properties. |
| Person credit         | Person to primary media      | Order, roles, optional character.                                        |
| Company credit        | Company to primary media     | Order and roles.                                                         |
| Group membership      | Group to matching media type | One-based order and roles.                                               |
| Library membership    | Entity to library            | Owned state, ownership sources, synchronization time.                    |
| Monitoring            | Entity to library            | No properties.                                                           |
| Collection membership | Entity to collection         | Collection-defined properties, if any.                                   |

Relationships are directional. A detail view for either endpoint may need the inverse perspective: contributor credits, media contributors, group members, an item's groups, parent hierarchy, or child hierarchy.

## Illustrative Demo Records

These are real records from the demo database. They illustrate actual richness, sparsity, cardinality, and value formats. They are examples, not minimum or guaranteed payloads. Long descriptions and arrays are abbreviated, but the reported counts are actual.

### Metadata-Rich Movie

`2001: A Space Odyssey` is a movie populated from TMDB.

```json
{
	"name": "2001: A Space Odyssey",
	"entitySchemaSlug": "movie",
	"providerId": "J60ZrESY6nv5J2tRzqrbZrwTVNe2PhuL",
	"externalId": "62",
	"properties": {
		"genres": ["Science Fiction", "Mystery", "Adventure"],
		"isNsfw": null,
		"runtime": 149,
		"sourceUrl": "https://www.themoviedb.org/movie/62",
		"description": "Humanity finds a mysterious object buried beneath the lunar surface and sets off to find its origins with the help of HAL 9000, the world's most advanced super computer.",
		"publishYear": 1968,
		"providerRating": 80.47,
		"productionStatus": "Released"
	}
}
```

Its `images` array contains 452 assets. One item is:

```json
{
	"type": "remote",
	"url": "https://image.tmdb.org/t/p/original/ve72VxNqjGM69Uky4WTo2bK6rfq.jpg"
}
```

Selected credit relationships demonstrate both contributor types and multiple roles on one relationship:

| Contributor                 | Type    | Roles                          |
| --------------------------- | ------- | ------------------------------ |
| Stanley Kubrick             | Person  | Producer, Screenplay, Director |
| Arthur C. Clarke            | Person  | Screenplay                     |
| Keir Dullea                 | Person  | Acting                         |
| Douglas Rain                | Person  | Acting                         |
| Metro-Goldwyn-Mayer         | Company | Production Company             |
| Stanley Kubrick Productions | Company | Production Company             |

These credit records do not contain an `order` or `character` value even though both are supported by the relationship model.

### Provider-Backed But Sparse Book

`A Court of Frost and Starlight` has provider identity but no populated catalog properties:

```json
{
	"name": "A Court of Frost and Starlight",
	"entitySchemaSlug": "book",
	"providerId": "2SFPr8pWnJUFafjlRiHycbUPUd3KvENn",
	"externalId": "OL19655889W",
	"properties": {}
}
```

This record has no description, image, creator, genre, date, page count, or rating in its current data.

### Episodic Show With Tracking History

`Attack on Titan` demonstrates a populated parent, a large child hierarchy, special season numbering, and fine-grained tracking events.

```json
{
	"name": "Attack on Titan",
	"entitySchemaSlug": "show",
	"externalId": "1429",
	"properties": {
		"genres": ["Animation", "Sci-Fi & Fantasy", "Action & Adventure"],
		"isNsfw": null,
		"publishYear": 2013,
		"totalSeasons": 5,
		"totalEpisodes": 124,
		"providerRating": 86.85000000000001,
		"productionStatus": "Ended"
	},
	"relatedSeasonCount": 5,
	"relatedEpisodeCount": 124
}
```

Its `images` array contains 468 assets.

Two season records show how specials and regular seasons coexist:

| Season   | Number | Release date | Related episodes |
| -------- | -----: | ------------ | ---------------: |
| Specials |      0 | 2013-07-07   |               37 |
| Season 1 |      1 | 2013-04-07   |               25 |

The first regular-season episode is represented separately:

```json
{
	"name": "To You, in 2000 Years: The Fall of Shiganshina (1)",
	"entitySchemaSlug": "show-episode",
	"properties": {
		"episodeNumber": 1,
		"publishDate": "2013-04-07",
		"runtime": 24,
		"description": "After one hundred years of peace, humanity is suddenly reminded of the terror of being at the Titans' mercy."
	}
}
```

The show's episode entities have 2,673 progress events and one review event in this demo dataset. Multiple progress events can describe one viewing session. For example, `Retrospective` has this sequence:

| Occurred at                      | Progress |
| -------------------------------- | -------: |
| 2024-02-19T16:23:59.067885+00:00 |   97.04% |
| 2024-02-19T16:24:30.314242+00:00 |   98.52% |
| 2024-02-19T16:25:01.435307+00:00 |     100% |

The review belongs to an episode rather than the show parent:

```json
{
	"entity": "The Final Chapters Special (2)",
	"eventSchemaSlug": "review",
	"occurredAt": "2024-02-20T08:56:33.983075+00:00",
	"properties": {
		"text": "This episode had so much fighting. I absolutely loved it. The fighting styles are reminiscent of the first few seasons so I actually enjoyed the teamwork the heroes put in.",
		"isSpoiler": false
	}
}
```

### Person With Reverse Credits

`Jenna Ortega` demonstrates a contributor entity that also connects to many media entities.

```json
{
	"name": "Jenna Ortega",
	"entitySchemaSlug": "person",
	"externalId": "974169",
	"properties": {
		"gender": "Female",
		"birthDate": "2002-09-27",
		"deathDate": null,
		"birthPlace": "Rancho Mirage, California, USA",
		"website": null,
		"alternateNames": ["Jenna Marie Ortega"],
		"sourceUrl": "https://www.themoviedb.org/person/974169"
	},
	"creditRelationshipCount": 71
}
```

Her `images` array contains 43 assets.

Selected reverse credits include movies and shows:

| Related entity          | Type  | Roles |
| ----------------------- | ----- | ----- |
| After Words             | Movie | Actor |
| American Carnage        | Movie | Actor |
| Beetlejuice Beetlejuice | Movie | Actor |
| AwesomenessTV           | Show  | Actor |
| Big City Greens         | Show  | Actor |
| CSI: NY                 | Show  | Actor |

The sampled credit relationships have no order or character value.

## Presentation-Relevant Data Constraints

These are data facts, not UI recommendations:

- Almost all provider properties are optional. Name, type, and internal identity are more stable than catalog richness.
- Arrays can be empty and related records can be absent.
- Images do not declare poster, backdrop, thumbnail, logo, or profile roles.
- Provider rating and personal review rating are separate values. Only personal review rating has a declared 0-100 range.
- Date properties are strings, while lifecycle timestamps and schedule times are datetimes.
- Duration units differ: movie and audiobook runtime use minutes; music duration uses seconds; video-game time-to-beat has no declared unit.
- Credits can have multiple roles, optional ordering, and an optional person character.
- Linked contributor relationships and unlinked creator text can coexist.
- Shows and podcasts can contain large child collections. Seasons, episodes, credits, group members, collections, and event history have unbounded cardinality at the data-model level.
- Event history can contain multiple records of the same type. A current status, latest progress, or aggregate review value is not intrinsic to one event record.
- Translation can affect the entity name, description, and images.
- Parent external IDs duplicate some hierarchy context but are not substitutes for internal entity relationships.
