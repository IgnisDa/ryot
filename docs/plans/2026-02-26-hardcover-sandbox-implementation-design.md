# Hardcover Sandbox Implementation Design

**Date:** 2026-02-26  
**Status:** Approved

## Overview

Implement Hardcover book provider support in the app-backend sandbox system, similar to existing OpenLibrary and Google Books implementations. This will enable users to search for books and retrieve detailed book information from Hardcover's API.

## Scope

**In Scope:**
- Book metadata search (`metadata_search`)
- Book metadata details (`metadata_details`)
- Integration with existing book entity schema

**Out of Scope:**
- Series (metadata groups) support
- People (authors/publishers) search and details
- Advanced features beyond basic book operations

## Architecture

### Component Overview

Two new sandbox script files will be created:

1. **`hardcover-book-search-source.txt`** - Implements book search functionality
2. **`hardcover-book-details-source.txt`** - Implements book details retrieval

### Integration Points

**Database Seeding (`seed.ts`):**
- Import both Hardcover script files
- Register as builtin sandbox scripts with slugs:
  - `hardcover.book.search`
  - `hardcover.book.details`
- Link both scripts to existing `book` entity schema with appropriate script types

**Configuration:**
- Use `BOOKS_HARDCOVER_API_KEY` for API authentication
- Retrieved via `getAppConfigValue("BOOKS_HARDCOVER_API_KEY")`
- Passed as `Authorization` header to Hardcover API

### API Integration

**Endpoint:** `https://api.hardcover.app/v1/graphql`  
**Protocol:** GraphQL (POST requests with JSON body)  
**Authentication:** Bearer token via `Authorization` header

## Search Script Design

### Input Contract

```javascript
context = {
  query: string,      // required - search term
  page: number,       // optional - page number (default: 1)
  pageSize: number    // optional - items per page (default: 20, max: 100)
}
```

### Processing Flow

1. **Input Validation**
   - Validate `query` is present and non-empty
   - Sanitize `page` (minimum 1, integer only)
   - Sanitize `pageSize` (between 1-100, integer only)

2. **API Key Retrieval**
   - Call `getAppConfigValue("BOOKS_HARDCOVER_API_KEY")`
   - Validate key exists and is non-empty
   - Throw error if not configured

3. **GraphQL Query Construction**
   ```graphql
   query {
     search(
       page: <page>,
       per_page: <pageSize>,
       query: "<query>",
       query_type: "book"
     ) {
       results
     }
   }
   ```

4. **API Request**
   - POST to `https://api.hardcover.app/v1/graphql`
   - Send Authorization header with API key
   - Include GraphQL query in JSON body

5. **Response Processing**
   - Parse JSON response
   - Navigate nested structure: `data.search.results`
   - Extract TypeSearch format: `found`, `hits[].document`
   - Map document fields: `id`, `title`, `release_year`, `image.url`

### Output Contract

```javascript
{
  items: [
    {
      identifier: string,      // Hardcover book ID
      title: string,
      publish_year: number | null,
      image: string | null     // Image URL or null
    }
  ],
  details: {
    total_items: number,
    next_page: number | null   // null if no more pages
  }
}
```

## Details Script Design

### Input Contract

```javascript
context = {
  identifier: string  // required - Hardcover book ID
}
```

### Processing Flow

1. **Input Validation**
   - Validate `identifier` is present and non-empty string

2. **API Key Retrieval**
   - Call `getAppConfigValue("BOOKS_HARDCOVER_API_KEY")`
   - Validate key exists
   - Throw error if not configured

3. **GraphQL Query Construction**
   ```graphql
   query {
     books_by_pk(id: <identifier>) {
       id
       slug
       pages
       title
       description
       release_year
       image { url }
       images { url }
       cached_tags
       book_series { series { id name } }
       contributions { 
         contribution 
         author_id 
         author { name } 
       }
     }
   }
   ```

4. **API Request**
   - POST to `https://api.hardcover.app/v1/graphql`
   - Send Authorization header
   - Include GraphQL query in JSON body

5. **Response Processing**
   - Parse JSON response
   - Navigate to `data.books_by_pk`
   - **Images:** Collect from both `image.url` and `images[].url` arrays
   - **Genres:** Extract from `cached_tags.Genre[].tag`
   - **People:** Map from `contributions` array with role, identifier, and name
   - **Series:** Extract from `book_series[].series`
   - **Source URL:** Construct from slug: `https://hardcover.app/books/{slug}`

### Output Contract

```javascript
{
  name: string,                    // Book title
  external_ids: {
    hardcover: string              // Hardcover book ID
  },
  properties: {
    pages: number | null,
    people: [
      {
        role: string,              // e.g., "Author", or contribution value
        source: "hardcover",
        identifier: string         // author_id as string
      }
    ],
    genres: string[],              // Genre tags
    publish_year: number | null,
    description: string | null,
    source_url: string,            // Link to Hardcover page
    assets: {
      remote_images: string[]      // Image URLs
    }
  }
}
```

## Error Handling

Both scripts will handle:
- **Missing API key:** Clear error message indicating configuration needed
- **Invalid JSON responses:** Catch parse errors with descriptive messages
- **API failures:** Check `response.success` and throw with error details
- **Missing required data:** Validate critical fields (e.g., title) exist
- **Empty results:** Return appropriate empty arrays/null values

## Implementation Approach

**Selected Approach:** Direct GraphQL Port

This approach:
- Maintains exact feature parity with Rust implementation
- Uses Hardcover's official GraphQL API
- Follows proven patterns from existing Rust code
- Provides type-safe, self-documenting queries
- Enables precise data retrieval in single requests

## Consistency with Existing Patterns

The implementation will:
- Follow exact structure of OpenLibrary and Google Books scripts
- Use identical input/output contracts for compatibility
- Apply same validation patterns (page size limits, input sanitization)
- Use consistent error message formatting
- Match field ordering conventions (ascending line length)

## Testing Considerations

After implementation:
1. Test search with various queries
2. Verify pagination works correctly
3. Test details retrieval with valid IDs
4. Confirm error handling for invalid API keys
5. Validate image collection from multiple sources
6. Verify genre and people extraction
7. Check source URL generation

## Next Steps

1. Create implementation plan
2. Implement search script
3. Implement details script
4. Update seed.ts with Hardcover integration
5. Test both scripts end-to-end
6. Update documentation if needed
