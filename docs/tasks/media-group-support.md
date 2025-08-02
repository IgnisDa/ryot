# Media Group Support

The internal abstraction uses `-group` slugs and `groupStub`/`groupPopulate` naming, but the
user-facing labels are domain-specific:

| Internal slug | User-facing label |
|---|---|
| `movie-group` | Movie Collection |
| `audiobook-group` | Audiobook Series |
| `book-group` | Book Series |
| `comic-book-group` | Comic Book Series |
| `music-group` | Music Album |
| `video-game-group` | Video Game Collection |

## Background

The V1 Ryot implementation had first-class support for metadata groups (movie collections, book
series, music albums, etc.) across 10 providers. This was never ported to the V2 sandbox system.

In V2, `person` and `company` are handled as first-class entity schemas with their own sandbox
scripts, worker jobs, and relationship schemas. This plan adds media-specific group entity schemas
following the same pattern.

## Providers with group support (V1)

| Provider | Media Type | Group Kind |
|---|---|---|
| TMDB | Movie | Collections |
| TVDB | Movie | Official Lists |
| Audible | AudioBook | Series |
| Hardcover | Book | Series |
| Metron | ComicBook | Series |
| Spotify | Music | Albums |
| MusicBrainz | Music | Release Groups |
| YouTube Music | Music | Albums |
| IGDB | VideoGame | Collections |
| Giant Bomb | VideoGame | Franchises |

## Entity schema design

Six new entity schemas — one per media type that has groups. Show, anime, manga, podcast, and
visual-novel have no group support in V1 and are excluded.

| Entity Schema | Relationship Schema | Script Slugs |
|---|---|---|
| `movie-group` | `movie-group to movie` | `movie-group.tmdb`, `movie-group.tvdb` |
| `audiobook-group` | `audiobook-group to audiobook` | `audiobook-group.audible` |
| `book-group` | `book-group to book` | `book-group.hardcover` |
| `comic-book-group` | `comic-book-group to comic-book` | `comic-book-group.metron` |
| `music-group` | `music-group to music` | `music-group.spotify`, `music-group.musicbrainz`, `music-group.youtube-music` |
| `video-game-group` | `video-game-group to video-game` | `video-game-group.igdb`, `video-game-group.giant-bomb` |

All six group entity schemas share a single `mediaGroupPropertiesSchema` (images, parts,
description, sourceUrl). The worker derives the group schema slug mechanically from the media
entity's own schema slug: `${mediaSchemaSlug}-group`.

## File changes

### New files

| Path | Purpose |
|---|---|
| `src/lib/media/media-group.ts` | Shared properties schema for all group types |
| `src/lib/sandbox/scripts/providers/media-group/tmdb.txt` | TMDB Collections script |
| `src/lib/sandbox/scripts/providers/media-group/tvdb.txt` | TVDB Lists script |
| `src/lib/sandbox/scripts/providers/media-group/audible.txt` | Audible Series script |
| `src/lib/sandbox/scripts/providers/media-group/hardcover.txt` | Hardcover Series script |
| `src/lib/sandbox/scripts/providers/media-group/metron.txt` | Metron Series script |
| `src/lib/sandbox/scripts/providers/media-group/spotify.txt` | Spotify Albums script |
| `src/lib/sandbox/scripts/providers/media-group/musicbrainz.txt` | MusicBrainz Release Groups script |
| `src/lib/sandbox/scripts/providers/media-group/youtube-music.txt` | YouTube Music Albums script |
| `src/lib/sandbox/scripts/providers/media-group/igdb.txt` | IGDB Collections script |
| `src/lib/sandbox/scripts/providers/media-group/giant-bomb.txt` | Giant Bomb Franchises script |

### Edited files

| Path | Change |
|---|---|
| `src/lib/media/common.ts` | Add `groupStubSchema` + `GroupStub` type |
| `src/modules/authentication/bootstrap/manifests.ts` | 6 entity schemas, 6 relationship schemas, 6 saved views |
| `src/lib/db/seed/manifests.ts` | 10 script entries + `groupSchemaScriptLinks()` |
| `src/modules/media/jobs.ts` | `groupPopulateJobName` + `groupPopulateJobData` |
| `src/modules/media/worker.ts` | `processGroupStubs`, `processGroupPopulateJob`, wire-up |
| `src/lib/sandbox/scripts/providers/media/movie/tmdb.txt` | Emit `groups` from `belongs_to_collection` |
| `src/lib/sandbox/scripts/providers/media/movie/tvdb.txt` | Emit `groups` from official lists |
| `src/lib/sandbox/scripts/providers/media/audiobook/audible.txt` | Emit `groups` from series |
| `src/lib/sandbox/scripts/providers/media/book/hardcover.txt` | Emit `groups` from book_series |
| `src/lib/sandbox/scripts/providers/media/comic-book/metron.txt` | Emit `groups` from series |
| `src/lib/sandbox/scripts/providers/media/music/spotify.txt` | Emit `groups` from album |
| `src/lib/sandbox/scripts/providers/media/music/musicbrainz.txt` | Emit `groups` from release-groups |
| `src/lib/sandbox/scripts/providers/media/music/youtube-music.txt` | Emit `groups` from album |
| `src/lib/sandbox/scripts/providers/media/video-game/igdb.txt` | Emit `groups` from collections |
| `src/lib/sandbox/scripts/providers/media/video-game/giant-bomb.txt` | Emit `groups` from franchises |

## Worker processing flow

1. Media `driver("details")` returns `properties.groups: [{ name, externalId, scriptSlug }]`
2. `processMediaImportJob` calls `processGroupStubs` after `processCompanyStubs`
3. `processGroupStubs` derives `groupSchemaSlug = "${mediaSchemaSlug}-group"`, silently skips
   media types with no group schema
4. Creates/finds the group entity, upserts `${groupSchemaSlug} to ${mediaSchemaSlug}` relationship
   (group as source, media as target)
5. Queues `groupPopulateJobName` for new/unpopulated groups
6. `processGroupPopulateJob` calls the group's sandbox `driver("details")`, validates against
   `mediaGroupPropertiesSchema.partial()`, updates the entity

## Group sandbox script contract

Every group script registers two drivers:

```
driver("search", async function(context) {
  // Returns standard search result shape: { items, details }
  // Providers without search support throw a clear error
})

driver("details", async function(context) {
  // Returns: { name: string, properties: { images, parts, description, sourceUrl } }
})
```

Group stubs emitted by media scripts:
```js
groups: [{ name: string, externalId: string, scriptSlug: string }]
// name may be "Loading..." for providers where the group name is not in the media response
// (IGDB: collections do not include name in game queries without extra fields)
```
