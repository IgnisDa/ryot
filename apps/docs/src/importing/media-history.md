# Media History

Media history (JSON) adds watch history and reviews for titles that Ryot looks up from a metadata
provider, such as TMDB shows and movies. Use it when another tool can write this format, or to add
history by hand.

::: info
Ryot fetches titles it does not have yet from their provider during the import. Configure that
provider first, such as `RYOT_PLUGIN__RYOT__MEDIA__TMDB_ACCESS_TOKEN` for TMDB titles.
:::

1. Save your history as a `.json` file in the format below.
2. Under **Settings > Import data**, select **Media history (JSON)** and upload the file.

## Format

The file is a JSON array with one entry per title:

| Field              | Meaning                                                  |
| ------------------ | -------------------------------------------------------- |
| `title`            | The title's name, shown in the import report             |
| `entitySchemaSlug` | The kind of media, such as `show`, `movie`, or `podcast` |
| `providerSlug`     | The provider that knows the title, such as `show.tmdb`   |
| `externalId`       | The title's ID at that provider                          |
| `events`           | The history to add to the title, in any order            |

Each event has:

| Field             | Meaning                                                                   |
| ----------------- | ------------------------------------------------------------------------- |
| `eventSchemaSlug` | What happened, such as `progress`, `complete`, or `review`                |
| `occurredAt`      | When it happened, as a UTC timestamp such as `2024-01-02T20:30:00Z`       |
| `episode`         | Optional. The episode or season of a show or podcast the event belongs to |
| `properties`      | The event's details, using the same fields as history you record in Ryot  |

An `episode` takes one of these forms:

- `{ "type": "show", "seasonNumber": 1, "episodeNumber": 2 }`
- `{ "type": "show-season", "seasonNumber": 1 }`, for a review of a whole season
- `{ "type": "podcast", "episodeNumber": 12 }`
- `{ "type": "podcast-title", "episodeTitle": "Pilot" }`

Common `properties` are `progressPercent`, `startedOn`, `timeSpent` in minutes, `consumedOn` (a
list of where you watched it), `calendarDate` when only the day is known, and `dateUnknown: true`
when the date is not known at all. Reviews use `rating` from 0 to 100, `text`, and `isSpoiler`.
Events that share a `sourceRun` text in one title belong to the same viewing.

```json
[
  {
    "title": "Example Show",
    "entitySchemaSlug": "show",
    "providerSlug": "show.tmdb",
    "externalId": "1399",
    "events": [
      {
        "eventSchemaSlug": "complete",
        "occurredAt": "2024-01-02T20:30:00Z",
        "episode": { "type": "show", "seasonNumber": 1, "episodeNumber": 2 },
        "properties": { "consumedOn": ["Plex"] }
      },
      {
        "eventSchemaSlug": "review",
        "occurredAt": "2024-01-03T09:00:00Z",
        "episode": { "type": "show-season", "seasonNumber": 1 },
        "properties": { "rating": 80, "text": "A strong first season." }
      }
    ]
  }
]
```

## What gets imported

- Each event is checked like history you record in Ryot. An event that does not fit is listed in
  the import report, and the rest of the title still imports.
- An event whose episode or season is not in the title's episode list is listed in the import
  report instead of being added to another episode.
- Importing the same file again adds the same history again.
