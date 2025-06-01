# GET Saved View by ID

**Parent Plan:** [View Runtime Foundation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add a `GET /saved-views/{viewId}` endpoint that returns a single saved view by ID. This endpoint returns both built-in and user-owned views, enabling the frontend to load any view the user has access to.

The end-to-end behavior: a client sends `GET /saved-views/{viewId}` with a valid view ID and receives the full saved view record including `queryDefinition` and `displayConfiguration`. Returns 404 for non-existent views.

### Route Handler

Add to `apps/app-backend/src/modules/saved-views/routes.ts`:
- `GET /saved-views/{viewId}` route
- Uses existing `getSavedViewByIdForUser(viewId, userId)` repository function (already exists per PRD)
- Returns the full saved view object including all new fields
- Returns 404 using `createNotFoundErrorResult` for non-existent views
- See PRD section "Saved Views Module Changes > New endpoints"

### Error Handling

Follow existing Hono patterns per PRD section "Error Handling":
- 404 with `createNotFoundErrorResult("Saved view not found")` for non-existent views
- 200 with `successResponse(data)` for successful retrieval

### E2E Tests

Add to `tests/src/tests/`:
- `GET /saved-views/{viewId}` returns 200 for existing built-in view (created during bootstrap)
- `GET /saved-views/{viewId}` returns 200 for user-owned view
- `GET /saved-views/{viewId}` returns 404 for non-existent view ID
- Response includes `queryDefinition` and `displayConfiguration` with correct structure
- Follow the pattern in `tests/src/tests/health.test.ts`

## Acceptance criteria

- [x] `GET /saved-views/{viewId}` route exists and is registered
- [x] Returns 200 with full saved view object for existing built-in views
- [x] Returns 200 with full saved view object for user-owned views
- [x] Returns 404 for non-existent view IDs
- [x] Response includes `queryDefinition` with `entitySchemaSlugs`, `filters`, `sort`
- [x] Response includes `displayConfiguration` with `layout`, `grid`, `list`, `table`
- [x] E2E tests pass for all cases (200 success, 404 not found)
- [x] `turbo check` passes

## Blocked by

- [Task 01](./01-saved-views-data-model-bootstrap.md)

## User stories addressed

- User story 36 (GET returns both built-in and user-owned views)
- User story 37 (errors follow existing Hono pattern)
