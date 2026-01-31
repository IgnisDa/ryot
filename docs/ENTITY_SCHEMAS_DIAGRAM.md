# Entity Schemas - Data Model Diagram

## Database Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                         Data Flow                                │
└─────────────────────────────────────────────────────────────────┘

User Request: POST /entity-schemas/list
  {
    userId: "user_123",
    trackerId?: "tracker_456",
    slugs?: ["book", "movie"]
  }
         │
         ▼
    listEntitySchemas() [service.ts:149-183]
         │
         ▼
    listEntitySchemasForUser() [repository.ts:56-116]
         │
         ▼
    Database Query (joins 4 tables)
         │
         ├─ FROM tracker_entity_schema
         │
         ├─ INNER JOIN tracker
         │
         ├─ INNER JOIN entity_schema
         │
         ├─ LEFT JOIN entity_schema_script
         │
         └─ LEFT JOIN sandbox_script
         │
         ▼
    Rows (multiple per schema, one per provider)
         │
         ▼
    Aggregation & Deduplication [repository.ts:92-112]
    (Map<schemaKey, entry+providers>)
         │
         ▼
    Transformation [repository.ts:51-54]
         │
         ▼
    Array<ListedEntitySchema>
         │
         ▼
    HTTP Response 200 OK
    {
      "data": [
        {
          id, name, slug, trackerId, isBuiltin,
          icon, accentColor, propertiesSchema,
          providers: [ { name, scriptId }, ... ]
        },
        ...
      ]
    }
```

## Entity Relationship Diagram

```
                    ┌──────────────────┐
                    │     user         │
                    │  (from auth)     │
                    └────────┬─────────┘
                             │
                ┌────────────┼────────────┐
                │            │            │
                ▼            ▼            ▼
        ┌─────────────┐  ┌──────────┐  ┌────────────┐
        │   tracker   │  │ entity   │  │ sandbox    │
        │             │  │ schema   │  │ script     │
        │ id          │  │          │  │            │
        │ userId (FK) │  │ id       │  │ id         │
        │ slug        │  │ userId   │  │ userId     │
        └─────────────┘  │ slug     │  │ slug       │
              │          │ name     │  │ name       │
              │          │ icon     │  │ code       │
              │          │ isBuiltin│  │ isBuiltin  │
              │          └────┬─────┘  └────────────┘
              │               │              │
              └──────────┬────┴──────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
┌──────────────────────────────────────────────┐
│   tracker_entity_schema (junction)           │
│   - trackerId (FK)                           │
│   - entitySchemaId (FK)                      │
│   Unique: (trackerId, entitySchemaId)        │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│   entity_schema_script (junction)            │
│   - entitySchemaId (FK)                      │
│   - sandboxScriptId (FK)                     │
│   Unique: (entitySchemaId, sandboxScriptId)  │
└──────────────────────────────────────────────┘
```

## Query Result Example

```
Database Query Returns (multiple rows):
┌─────────────┬──────────────────┬───────────┬─────────────────┐
│ entityId    │ entityName       │ scriptId  │ scriptName      │
├─────────────┼──────────────────┼───────────┼─────────────────┤
│ schema_001  │ Book             │ script_A  │ Hardcover       │
│ schema_001  │ Book             │ script_B  │ OpenLibrary     │
│ schema_001  │ Book             │ script_C  │ Google Books    │
│ schema_002  │ Movie            │ script_D  │ TMDB            │
│ schema_002  │ Movie            │ script_E  │ TVDB            │
└─────────────┴──────────────────┴───────────┴─────────────────┘

Aggregation Algorithm (repository.ts:92-112):
  Map {
    'schema_001::tracker_456' => {
      entry: {
        id: 'schema_001',
        name: 'Book',
        slug: 'book',
        trackerId: 'tracker_456',
        providers: [
          { name: 'Hardcover', scriptId: 'script_A' },
          { name: 'OpenLibrary', scriptId: 'script_B' },
          { name: 'Google Books', scriptId: 'script_C' }
        ]
      },
      seen: Set(['script_A', 'script_B', 'script_C'])
    },
    'schema_002::tracker_456' => {
      entry: {
        id: 'schema_002',
        name: 'Movie',
        slug: 'movie',
        trackerId: 'tracker_456',
        providers: [
          { name: 'TMDB', scriptId: 'script_D' },
          { name: 'TVDB', scriptId: 'script_E' }
        ]
      },
      seen: Set(['script_D', 'script_E'])
    }
  }

Final Result: Array<ListedEntitySchema>
  [
    { id: 'schema_001', name: 'Book', ..., providers: [...] },
    { id: 'schema_002', name: 'Movie', ..., providers: [...] }
  ]
```

## Provider Configuration Flow

```
User configures API keys in environment:
  BOOKS_HARDCOVER_API_KEY=xyz123
  MUSIC_SPOTIFY_CLIENT_ID=abc789
  etc.

User calls POST /entity-schemas/list
  ↓
Returns ALL providers (regardless of config):
  {
    "data": [{
      "slug": "book",
      "providers": [
        { "name": "Hardcover", "scriptId": "s1" },         ← needs API key
        { "name": "OpenLibrary", "scriptId": "s2" },       ← no API key needed
        { "name": "Google Books", "scriptId": "s3" }       ← needs API key
      ]
    }]
  }

User selects a provider and searches: POST /entity-schemas/search
  { "scriptId": "s1", "context": { "query": "..." } }
  ↓
Sandbox Script executes:
  const apiKey = await getAppConfigValue("BOOKS_HARDCOVER_API_KEY");
  if (!apiKey?.value) {
    throw new Error("BOOKS_HARDCOVER_API_KEY is not configured");  ← Error here!
  }
  // ... use apiKey to search
  ↓
If API key not configured, user sees error:
  "BOOKS_HARDCOVER_API_KEY is not configured"

If API key IS configured:
  Returns search results normally
```

## Builtin Providers (31 Total)

```
Books (3):
  • book.hardcover        (requires BOOKS_HARDCOVER_API_KEY)
  • book.openlibrary      (no API key)
  • book.google-book      (requires BOOKS_GOOGLE_BOOKS_API_KEY)

Movies/Shows (4):
  • movie.tmdb / show.tmdb    (requires MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN)
  • movie.tvdb / show.tvdb    (requires MOVIES_AND_SHOWS_TVDB_API_KEY)

Anime (2):
  • anime.anilist         (no API key)
  • anime.myanimelist     (requires ANIME_AND_MANGA_MAL_CLIENT_ID)

Manga (3):
  • manga.anilist         (no API key)
  • manga.myanimelist     (requires ANIME_AND_MANGA_MAL_CLIENT_ID)
  • manga.manga-updates   (no API key)

Music (3):
  • music.spotify         (requires MUSIC_SPOTIFY_CLIENT_ID + MUSIC_SPOTIFY_CLIENT_SECRET)
  • music.musicbrainz     (no API key)
  • music.youtube-music   (no API key)

Podcasts (2):
  • podcast.itunes        (no API key)
  • podcast.listennotes   (requires PODCASTS_LISTENNOTES_API_KEY)

Comic Books (1):
  • comic-book.metron     (requires COMIC_BOOK_METRON_USERNAME + COMIC_BOOK_METRON_PASSWORD)

Audiobooks (1):
  • audiobook.audible     (no API key)

Video Games (2):
  • video-game.giant-bomb (requires VIDEO_GAMES_GIANT_BOMB_API_KEY)
  • video-game.igdb       (requires Twitch credentials)

Visual Novels (1):
  • visual-novel.vndb     (no API key)

Persons (8):
  • person.anilist        (no API key)
  • person.hardcover      (requires BOOKS_HARDCOVER_API_KEY)
  • person.audible        (no API key)
  • person.metron         (requires COMIC_BOOK_METRON_*)
  • person.musicbrainz    (no API key)
  • person.spotify        (requires MUSIC_SPOTIFY_*)
  • person.youtube-music  (no API key)
  • person.vndb           (no API key)
```

## Type Hierarchy

```
Provider
  ├─ name: string             (display name: "Hardcover")
  └─ scriptId: string         (database ID of sandbox_script)

ListedEntitySchema
  ├─ id: string
  ├─ name: string             (e.g., "Book", "Movie")
  ├─ slug: string             (unique per user + tracker)
  ├─ trackerId: string
  ├─ isBuiltin: boolean
  ├─ icon: string
  ├─ accentColor: string      (hex color)
  ├─ propertiesSchema: object (field definitions + validation)
  └─ providers: Provider[]    ← many-to-many relationship

CreateEntitySchemaBody
  ├─ name: string
  ├─ slug?: string
  ├─ trackerId: string        ← which tracker owns this
  ├─ propertiesSchema: object
  ├─ icon: string
  └─ accentColor: string
```

## Access Control Pattern

```
Who can list schemas?
  ✓ Authenticated users can list their own schemas
  ✓ Builtin schemas visible to all authenticated users
  ✗ Cannot access other users' custom schemas

Who can create schemas?
  ✓ Only on custom trackers (not builtin trackers like "media")
  ✓ Slug must not be reserved (not a builtin schema slug)
  ✓ Slug must be unique per user + tracker

Who can see providers?
  ✓ All associated providers visible in /list
  ✗ No filtering based on API key configuration
  ✗ Errors only at search/import time if key missing
```
