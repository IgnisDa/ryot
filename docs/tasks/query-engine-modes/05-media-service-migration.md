# Media Service Migration

**Parent Plan:** [Query Engine Modes](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Replace the media service's hardcoded custom queries with the new query engine modes. This proves the engine extension solves the real problem and eliminates:

- The 10k-row fetch-and-reduce antipattern in `getLibraryStats`
- Custom Drizzle queries in the media repository for activity and week sections

### Migrate `getLibraryStats` to aggregate mode

Replace the current implementation (which fetches up to 10,000 entity rows and aggregates in TypeScript) with a single aggregate-mode query engine call.

The aggregate request should include:

- `scope`: all builtin media entity schema slugs
- `relationships`: `[{ relationshipSchemaSlug: "in-library" }]`
- `eventJoins`: latest review, backlog, progress, complete events
- `aggregations`:
  - `total`: `{ type: "count" }`
  - `inBacklog`: `{ type: "countWhere", predicate: ... }` (backlog exists, no progress, no complete)
  - `inProgress`: `{ type: "countWhere", predicate: ... }` (progress newer than complete)
  - `completed`: `{ type: "countWhere", predicate: ... }` (complete newer than progress)
  - `avgRating`: `{ type: "avg", expression: review.properties.rating }`
  - `bySchema`: `{ type: "countBy", groupBy: entity-schema.slug }`

This eliminates the row limit entirely — stats are correct for any library size.

### Migrate `getRecentActivityItems` to events mode

Replace the current implementation (custom Drizzle query in `listRecentActivityEventsForUser`) with an events-mode query engine call.

The events request should include:

- `scope`: all builtin media entity schema slugs
- `eventSchemas`: `["review", "complete", "progress", "backlog"]`
- `sort`: `event.createdAt DESC`
- `pagination`: `{ page: 1, limit: 12 }`
- `fields`: event id, event createdAt, event properties (rating, completedOn), entity name, entity image, entity-schema slug, event-schema slug

The response transformer (`buildRecentActivitySectionResponse`) may need adjustment to work with the query engine's `{ key, kind, value }` field format instead of the current repository row format.

### Migrate `getWeekActivity` to time-series mode

Replace the current implementation (custom Drizzle query in `listWeekActivityEventsForUser` + TypeScript date bucketing) with a time-series-mode query engine call.

The time-series request should include:

- `scope`: all builtin media entity schema slugs
- `eventSchemas`: `["review", "complete", "progress", "backlog"]`
- `dateRange`: current ISO week bounds (computed at call site using dayjs)
- `bucket`: `"day"`
- `metric`: `{ type: "count" }`

The response maps directly to the existing `{ date, count }` section response format.

### Remove custom repository queries

After all three migrations, remove from `~/modules/media/repository.ts`:

- `listRecentActivityEventsForUser`
- `listWeekActivityEventsForUser`
- Any helper functions that become unused (`recentActivitySelection`, `mediaActivityPredicates`, `resolveOccurredAt`, etc.)

If the repository file becomes empty, remove it entirely.

### Update media service dependencies

The `MediaServiceDeps` type and default dependency injection pattern should be updated:

- Remove `listWeekActivityEventsForUser` and `listRecentActivityEventsForUser` deps
- The `executeSectionQuery` dep remains (now used for all section types via the unified endpoint)
- Or replace with a single `executeQuery` dep that accepts any mode's request

### Update tests

Update media service tests to verify:

- `getLibraryStats` returns correct aggregates without the 10k limit
- `getRecentActivityItems` returns correct event-based results
- `getWeekActivity` returns correct daily buckets
- Test dependency injection still works for unit testing (mock the query engine call)

## Acceptance criteria

- [x] `getLibraryStats` uses aggregate mode and produces correct stats for any library size (no 10k limit)
- [x] `getRecentActivityItems` uses events mode and returns the same data shape as before
- [x] `getWeekActivity` uses time-series mode and returns correct 7-day bucket array
- [x] Custom Drizzle queries removed from media repository (`listRecentActivityEventsForUser`, `listWeekActivityEventsForUser`)
- [x] No custom SQL remains for media overview sections that the query engine can now handle
- [x] Media service tests pass with the new implementations
- [x] The media overview API endpoints return equivalent responses (same data, possibly different internal flow)
- [x] `bun run typecheck`, `bun run test`, and `bun run lint` pass

## User stories addressed

- User story 22
- User story 23
- User story 24
