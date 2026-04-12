# Entity Schemas Module - Comprehensive Analysis

## Data Model

### Database Tables

The entity-schemas module involves three main tables:

1. **`entity_schema`** - Stores schema definitions
   - `id` (PK): Unique identifier
   - `slug`: URL-friendly identifier (unique per user)
   - `name`: Human-readable name
   - `icon`: Icon identifier (e.g., "book-open")
   - `accentColor`: Hex color code
   - `propertiesSchema`: JSONB containing field definitions and validation rules
   - `isBuiltin`: Boolean flag (true for system-provided schemas like "book", "movie", etc.)
   - `userId`: References user (null for builtin schemas)
   - `createdAt`, `updatedAt`: Timestamps
   - **Unique constraint**: `(userId, slug)` - prevents duplicate slugs per user

2. **`sandbox_script`** - Stores provider scripts (data sources)
   - `id` (PK): Unique identifier
   - `slug`: URL-friendly identifier (format: `{mediaType}.{providerName}`, e.g., "book.hardcover")
   - `name`: Display name (e.g., "Hardcover", "Google Books")
   - `code`: JavaScript code that searches/imports from that provider
   - `isBuiltin`: Boolean (true for system-provided providers)
   - `userId`: References user (null for builtin)
   - `createdAt`, `updatedAt`: Timestamps
   - **Contains built-in providers** for books, movies, shows, manga, anime, music, podcasts, video games, audiobooks, comic books, visual novels, and persons

3. **`entity_schema_script`** (Junction table) - Associates schemas with providers
   - `id` (PK): Unique identifier
   - `entitySchemaId`: FK to `entity_schema`
   - `sandboxScriptId`: FK to `sandbox_script`
   - `createdAt`, `updatedAt`: Timestamps
   - **Unique constraint**: `(entitySchemaId, sandboxScriptId)` - each provider linked once per schema

4. **`tracker_entity_schema`** (Junction table) - Associates entity schemas with trackers
   - `id` (PK): Unique identifier
   - `trackerId`: FK to tracker
   - `entitySchemaId`: FK to entity schema
   - `createdAt`, `updatedAt`: Timestamps
   - **Unique constraint**: `(trackerId, entitySchemaId)` - each schema linked once per tracker

### Type Definitions

From `schemas.ts`:

```typescript
export type Provider = {
  name: string;        // Display name (e.g., "Hardcover")
  scriptId: string;    // ID of the sandbox script
};

export type ListedEntitySchema = {
  id: string;
  name: string;
  slug: string;
  trackerId: string;
  isBuiltin: boolean;
  providers: Provider[];           // Array of provider scripts
  propertiesSchema: object;        // Field definitions
  icon: string;
  accentColor: string;
};
```

## What `listEntitySchemas` Returns

### Function Signature
```typescript
export const listEntitySchemas = async (
  input: { 
    slugs?: string[];           // Filter by schema slugs
    trackerId?: string;         // Filter by tracker
    userId: string;             // Required: user's ID
  },
  deps: EntitySchemaServiceDeps = entitySchemaServiceDeps,
): Promise<EntitySchemaServiceResult<ListedEntitySchema[]>>
```

### Return Structure
Returns an array of `ListedEntitySchema` objects with all schemas for the user, optionally filtered by:
- **trackerId**: Only schemas associated with this tracker
- **slugs**: Only schemas matching these slugs (e.g., ["book", "movie"])

### Query Flow (from `repository.ts`)

1. **Database Query** joins across 4 tables:
   - `tracker_entity_schema` (entrypoint, joins tracker)
   - `entity_schema` (the schema definition)
   - `entity_schema_script` (left join for providers)
   - `sandbox_script` (left join for provider details)

2. **Provider Aggregation**:
   - The database returns multiple rows per schema (one for each provider)
   - A `Map<schemaKey, record>` deduplicates rows and collects providers
   - Uses `seen` Set to prevent duplicate providers with the same scriptId

3. **Output Transformation**:
   - Normalizes `propertiesSchema` from JSONB to typed object
   - Returns deduplicated schema entries with all associated providers

Example response:
```json
{
  "data": [
    {
      "id": "schema_001",
      "name": "Book",
      "slug": "book",
      "trackerId": "media_tracker",
      "isBuiltin": true,
      "icon": "book-open",
      "accentColor": "#5B7FFF",
      "propertiesSchema": { "fields": { ... } },
      "providers": [
        { "name": "Hardcover", "scriptId": "script_001" },
        { "name": "OpenLibrary", "scriptId": "script_002" },
        { "name": "Google Books", "scriptId": "script_003" }
      ]
    },
    // ... more schemas
  ]
}
```

## What "Providers" Means

In this context, **providers** are **data sources** - external services that can search for or import entities of a given schema type.

### Provider Characteristics

1. **Entity**: `sandbox_script` row with `isBuiltin = true`
2. **Code**: JavaScript that runs in a sandboxed environment
3. **Relationship**: Many-to-many with entity schemas (via `entity_schema_script`)
4. **API Keys**: Some providers require configuration (env variables)

### Built-in Provider Examples

From `/lib/db/seed/manifests.ts`:

```
Books:
  - Hardcover (BOOKS_HARDCOVER_API_KEY required)
  - OpenLibrary (no API key needed)
  - Google Books (BOOKS_GOOGLE_BOOKS_API_KEY required)

Movies/Shows:
  - TMDB (MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN required)
  - TVDB (MOVIES_AND_SHOWS_TVDB_API_KEY required)

Music:
  - Spotify (MUSIC_SPOTIFY_CLIENT_ID, MUSIC_SPOTIFY_CLIENT_SECRET required)
  - MusicBrainz (no API key needed)
  - YouTube Music (no API key needed)

Anime:
  - AniList (no API key needed)
  - MyAnimeList (ANIME_AND_MANGA_MAL_CLIENT_ID required)

etc.
```

### How Providers Check for Configuration

Provider scripts (JavaScript) call the `getAppConfigValue()` host function:

```javascript
// From hardcover.txt provider script
const configValueResponse = await getAppConfigValue("BOOKS_HARDCOVER_API_KEY");
if (!configValueResponse.data?.value) {
  throw new Error("BOOKS_HARDCOVER_API_KEY is not configured");
}
```

The `getAppConfigValue()` function (in `/lib/sandbox/host-functions/get-app-config-value.ts`):
- Checks if a key exists in the `appConfig` object
- Returns the value (or null if not configured)
- Providers throw an error if the required API key is missing

## What "Usable" Means

Based on the codebase analysis, **"usable" is NOT currently implemented in the entity-schemas module**. However, the concept would mean:

A provider is **usable** if:
1. It's a valid `sandbox_script` record associated with an entity schema
2. **AND** (if required by the provider) its necessary API key is configured in environment variables

### Current State
- The `/list` endpoint returns **ALL** providers for each schema, regardless of configuration
- Providers only fail when actually executed (not at list time)
- No filtering of providers based on configured API keys happens in the backend service layer

### Why Not Implemented
1. **Performance**: Checking env vars for every provider would require additional logic
2. **Decoupling**: The schema listing doesn't execute scripts; only when a user tries to search/import
3. **Determinism**: Provider availability is dynamic (users could configure API keys after listing)

## App Configuration

From `/lib/config.ts`:

```typescript
// Required config (always checked)
const configSchema = z.object({
  REDIS_URL: z.string(),
  DATABASE_URL: z.string(),
  FRONTEND_URL: z.string(),
  SERVER_ADMIN_ACCESS_TOKEN: z.string(),
  PORT: z.string().default("8000"),
  NODE_ENV: z.string().default("production"),
  // ... S3 config (optional)
  USERS_ALLOW_REGISTRATION: z.string().default("true"),
});

// Provider-specific config (optional)
const appConfigSchema = z.object({
  BOOKS_HARDCOVER_API_KEY: z.string().optional(),
  BOOKS_GOOGLE_BOOKS_API_KEY: z.string().optional(),
  MUSIC_SPOTIFY_CLIENT_ID: z.string().optional(),
  MUSIC_SPOTIFY_CLIENT_SECRET: z.string().optional(),
  MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN: z.string().optional(),
  MOVIES_AND_SHOWS_TVDB_API_KEY: z.string().optional(),
  ANIME_AND_MANGA_MAL_CLIENT_ID: z.string().optional(),
  VIDEO_GAMES_GIANT_BOMB_API_KEY: z.string().optional(),
  VIDEO_GAMES_TWITCH_CLIENT_ID: z.string().optional(),
  VIDEO_GAMES_TWITCH_CLIENT_SECRET: z.string().optional(),
  COMIC_BOOK_METRON_USERNAME: z.string().optional(),
  COMIC_BOOK_METRON_PASSWORD: z.string().optional(),
  PODCASTS_LISTENNOTES_API_KEY: z.string().optional(),
  // ... more providers
});

export const appConfig = appConfigSchema.parse(process.env);
```

## Existing Patterns for Provider Filtering

### 1. Entity Schema Script Links (Seeding)

From `/lib/db/seed/manifests.ts`:

```typescript
// Hardcoded mapping of which providers should be linked to which schemas
export const entitySchemaScriptLinks = () =>
  [
    { schemaSlug: "book", scriptSlug: "book.openlibrary" },
    { schemaSlug: "book", scriptSlug: "book.google-book" },
    { schemaSlug: "book", scriptSlug: "book.hardcover" },
    { schemaSlug: "movie", scriptSlug: "movie.tmdb" },
    { schemaSlug: "movie", scriptSlug: "movie.tvdb" },
    // ... all builtin providers
  ] as const;
```

**Pattern**: The relationships are defined at schema creation/initialization time, not dynamically filtered.

### 2. Builtin Media Entity Schema Slugs (Constants)

From `/lib/media/constants.ts`:

```typescript
// Derived from the seeded provider links
export const builtinMediaEntitySchemaSlugs = [
  "book", "movie", "show", "anime", "manga", "music", 
  "podcast", "audiobook", "video-game", "comic-book", 
  "visual-novel", "person"
] as const;

export type BuiltinMediaEntitySchemaSlug = typeof builtinMediaEntitySchemaSlugs[number];
```

**Pattern**: A readonly set/array for type-safe filtering elsewhere.

### 3. Runtime Configuration Access

From `/lib/sandbox/host-functions/get-app-config-value.ts`:

```typescript
export const getAppConfigValue: HostFunction = async (
  _context,
  key,
): Promise<ConfigValueResult> => {
  if (!(trimmedKey in appConfig)) {
    return apiFailure(`Config key "${trimmedKey}" does not exist`);
  }
  const value = appConfig[trimmedKey];
  return apiSuccess(value ?? null);  // Returns null if not configured
};
```

**Pattern**: Providers check config at execution time (not list time).

## How Other Modules Handle Similar Scenarios

### Event Schemas Module
- Similar structure to entity-schemas (has list, create, delete operations)
- Also has parent-child relationship (events belong to entity schemas)
- **Does NOT filter** event schemas based on availability
- Returns all events the user can access

### Repository Pattern
All modules follow this pattern for listing:
1. Database query with filters (userId, optional trackerId, slugs, etc.)
2. Result transformation/normalization
3. Return all matching records without post-filtering

**Pattern**: Filtering happens at the database query level, not post-query in TypeScript.

### Access Control Pattern
From `~/lib/access`:
```typescript
checkReadAccess()   // Verifies user can read the resource
checkCustomAccess() // Verifies resource is user-created (not builtin)
```

This is used when creating or modifying schemas, but NOT when listing.

## Summary of Key Design Decisions

1. **No Provider Filtering in List Endpoint**: All available providers returned with each schema
2. **Lazy Execution Validation**: Provider validation happens when actually used (search, import)
3. **Immutable Provider Assignments**: Provider-schema relationships defined at initialization
4. **Flat Result Structure**: All data returned in a single response (not paginated/lazy-loaded)
5. **Type-Safe Builtin References**: Builtin schemas/providers tracked as readonly constants
6. **Optional API Key Pattern**: Providers gracefully handle missing API keys at runtime

## Potential Enhancement: Filtering by Usability

If filtering "usable providers" were to be implemented:

```typescript
// Hypothetical: Check provider configuration
const isProviderUsable = (provider: Provider, scriptCode: string): boolean => {
  // Parse required env vars from script code
  const requiredVars = extractRequiredConfigVars(scriptCode);
  
  // Check if all are configured
  return requiredVars.every(varName => 
    Object.keys(appConfig).includes(varName) && appConfig[varName]
  );
};

// Or: Return metadata about usability
type EnrichedProvider = Provider & {
  isUsable: boolean;
  missingConfig?: string[];  // Which API keys are needed
};
```

However, this would require:
- Parsing/analyzing provider scripts to extract required config vars
- Adding a `scriptCode` field to the Provider type
- Updating the database query to fetch script code (performance impact)
- Handling dynamic config changes during user sessions
