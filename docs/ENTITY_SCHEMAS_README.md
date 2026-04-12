# Entity Schemas Module - Complete Documentation

This documentation provides a thorough exploration of the entity-schemas module in the Ryot application.

## Files in This Documentation

### 1. **ENTITY_SCHEMAS_ANALYSIS.md** (Main Document)
Comprehensive analysis covering:
- Complete data model with all database tables
- Type definitions and TypeScript types
- How `listEntitySchemas` works and what it returns
- What "providers" are and how they're associated with schemas
- How providers check for API key configuration
- Current state of "usable provider" concept
- App configuration structure
- Existing patterns for provider filtering in the codebase
- How other modules handle similar scenarios
- Key design decisions
- Potential enhancements for provider usability filtering

**→ Start here for the full picture**

### 2. **ENTITY_SCHEMAS_DIAGRAM.md** (Visual Reference)
Visual representations including:
- Data flow diagram from user request to response
- Entity Relationship Diagram (ERD) showing all table connections
- Query result example with aggregation algorithm
- Provider configuration flow
- All 31 builtin providers with their API key requirements
- Type hierarchy
- Access control patterns

**→ Use this for understanding architecture at a glance**

## Quick Summary

### The Data Model
```
entity_schema ←→ entity_schema_script ←→ sandbox_script
     ↑                                           ↑
     └─────── tracker_entity_schema ────────────┘
```

- **entity_schema**: Defines entity types (Book, Movie, Person, etc.)
- **sandbox_script**: Providers - external services that can search/import for a schema type
- **entity_schema_script**: Junction table linking schemas to their providers (many-to-many)
- **tracker_entity_schema**: Links schemas to trackers

### What `/list` Returns
An array of `ListedEntitySchema` objects, each containing:
- Schema metadata (id, name, slug, icon, color, properties)
- Array of `Provider` objects (name and scriptId)
- All providers returned regardless of API key configuration

### Providers
- External data sources (e.g., "Hardcover", "Spotify", "TMDB")
- 31 builtin providers seeded at initialization
- Some require API keys, others don't
- Validation happens at execution time, not at list time

### "Usable" Concept
Currently NOT implemented. A provider would be "usable" if:
1. It's a valid sandbox_script associated with the schema
2. Its required API keys (if any) are configured in environment variables

The system returns all providers and lets them fail at runtime if keys are missing.

## Key Files in the Codebase

### Core Module Files
- `/apps/app-backend/src/modules/entity-schemas/service.ts` - Main business logic
- `/apps/app-backend/src/modules/entity-schemas/repository.ts` - Database operations
- `/apps/app-backend/src/modules/entity-schemas/schemas.ts` - Type definitions
- `/apps/app-backend/src/modules/entity-schemas/routes.ts` - API endpoints

### Database Schema
- `/apps/app-backend/src/lib/db/schema/tables.ts` - Table definitions (lines 88-232)

### Configuration
- `/apps/app-backend/src/lib/config.ts` - All config options including API keys
- `/apps/app-backend/src/lib/db/seed/manifests.ts` - Builtin providers and associations

### Related Modules
- `/apps/app-backend/src/modules/sandbox/` - Executes provider scripts
- `/apps/app-backend/src/modules/event-schemas/` - Similar pattern for event schemas
- `/apps/app-backend/src/modules/authentication/bootstrap/manifests.ts` - Builtin schemas

## Critical Query Flow

```
listEntitySchemas(userId, trackerId?, slugs?)
  ↓
listEntitySchemasForUser() [repository]
  ↓
Database query joins:
  tracker_entity_schema
  → tracker
  → entity_schema
  → entity_schema_script (left join)
  → sandbox_script (left join)
  ↓
Rows aggregation (Map with deduplication)
  ↓
Result transformation
  ↓
Array<ListedEntitySchema>
```

## Design Decisions Explained

### Why No Provider Filtering at List Time?
1. **Performance**: Would require parsing scripts or maintaining config mappings
2. **Decoupling**: Schema listing is separate from script execution
3. **Determinism**: Provider availability can change (users configure keys during session)
4. **Simplicity**: Return all available options, let execution layer handle validation

### Why Junction Tables?
- Many-to-many relationships (one schema can have multiple providers)
- Prevents data duplication
- Allows flexible associations

### Why Aggregation in Code?
- Database returns multiple rows per schema (one per provider)
- Map with deduplication key (`${id}::${trackerId}`) collects them into single schema
- Prevents N+1 query problem and keeps query simple

## Example Response

```json
{
  "data": [
    {
      "id": "schema_abc123",
      "name": "Book",
      "slug": "book",
      "trackerId": "tracker_xyz789",
      "isBuiltin": true,
      "icon": "book-open",
      "accentColor": "#5B7FFF",
      "propertiesSchema": {
        "fields": {
          "title": { "type": "string", "label": "Title" },
          "author": { "type": "string", "label": "Author" }
        }
      },
      "providers": [
        { "name": "Hardcover", "scriptId": "provider_1" },
        { "name": "OpenLibrary", "scriptId": "provider_2" },
        { "name": "Google Books", "scriptId": "provider_3" }
      ]
    },
    {
      "id": "schema_def456",
      "name": "Movie",
      "slug": "movie",
      "trackerId": "tracker_xyz789",
      "isBuiltin": true,
      "icon": "clapperboard",
      "accentColor": "#FACC15",
      "propertiesSchema": { "fields": { ... } },
      "providers": [
        { "name": "TMDB", "scriptId": "provider_4" },
        { "name": "TVDB", "scriptId": "provider_5" }
      ]
    }
  ]
}
```

## Configuration for Providers

Some providers require API keys. From `/lib/config.ts`:

```
BOOKS_HARDCOVER_API_KEY
BOOKS_GOOGLE_BOOKS_API_KEY
MUSIC_SPOTIFY_CLIENT_ID
MUSIC_SPOTIFY_CLIENT_SECRET
MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN
MOVIES_AND_SHOWS_TVDB_API_KEY
ANIME_AND_MANGA_MAL_CLIENT_ID
VIDEO_GAMES_GIANT_BOMB_API_KEY
VIDEO_GAMES_TWITCH_CLIENT_ID
VIDEO_GAMES_TWITCH_CLIENT_SECRET
COMIC_BOOK_METRON_USERNAME
COMIC_BOOK_METRON_PASSWORD
PODCASTS_LISTENNOTES_API_KEY
```

All are optional. Providers check at runtime via `getAppConfigValue(key)`.

## Related Patterns Elsewhere

### Event Schemas
Similar structure - list, create, update operations on child entities of schemas.
Also does NOT filter based on availability.

### Access Control
- `checkReadAccess()` - Verify user can read resource
- `checkCustomAccess()` - Verify resource is user-created (not builtin)
Used when modifying schemas, not when listing.

### Repository Pattern
Standard across all modules:
1. Database query with filters
2. Result transformation/normalization
3. No post-query filtering

## Potential Future Enhancement

If filtering "usable" providers should be implemented:

```typescript
type EnrichedProvider = Provider & {
  isUsable: boolean;
  requiredConfig?: string[];
  configuredValues?: Record<string, boolean>;
};

// Would require:
// - Parsing scripts for @requires directives or hardcoding per provider
// - Fetching script code in database query
// - Checking env vars for each provider
// - Returning metadata about missing config
```

Benefits: Better UX (disable unusable providers in UI)
Costs: Query performance, script parsing complexity

## Testing Recommendations

The module has tests in `/modules/entity-schemas/service.test.ts` covering:
- Resolver validation functions
- Entity schema creation
- Access control
- Listing behavior

Would benefit from tests for:
- Provider filtering/aggregation logic
- Multi-tracker queries
- Edge cases in deduplication

---

**Documentation generated:** April 2025
**Module location:** `/apps/app-backend/src/modules/entity-schemas/`
**Related test file:** `/apps/app-backend/src/modules/entity-schemas/service.test.ts`
