# PUT Saved View (Full Replacement)

**Parent Plan:** [View Runtime Foundation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add a `PUT /saved-views/{viewId}` endpoint that performs full replacement of a saved view. Clients must provide the complete view definition (all fields required except immutable ones). This uses PUT semantics rather than PATCH to avoid merge complexity.

The end-to-end behavior: a client sends `PUT /saved-views/{viewId}` with a complete saved view definition (name, icon, accentColor, trackerId, queryDefinition, displayConfiguration) and the entire view record is replaced. Immutable fields (id, isBuiltin, userId, createdAt, updatedAt) are preserved regardless of what the client sends.

### Route Handler

Add to `apps/app-backend/src/modules/saved-views/routes.ts`:
- `PUT /saved-views/{viewId}` route
- Request schema excludes immutable fields: `id`, `isBuiltin`, `userId`, `createdAt`, `updatedAt`
- All other fields are required (full replacement, not partial update)
- Returns 404 for non-existent views
- See PRD sections "Saved Views Module Changes > New endpoints" and "Why PUT Instead of PATCH"

### Repository Function

Add to `apps/app-backend/src/modules/saved-views/repository.ts`:
- `updateSavedViewByIdForUser(viewId, userId, input)` function
- Updates all mutable fields
- Preserves immutable fields (id, isBuiltin, userId, createdAt)
- Sets `updatedAt` to current timestamp
- Returns updated view or undefined if not found

### Error Handling

- 404 with `createNotFoundErrorResult("Saved view not found")` for non-existent views
- 200 with `successResponse(data)` for successful update
- See PRD section "Error Handling"

### E2E Tests

Add to `tests/src/tests/`:
- `PUT /saved-views/{viewId}` updates view successfully (200)
- `PUT /saved-views/{viewId}` returns 404 for non-existent view
- `PUT /saved-views/{viewId}` preserves immutable fields (id, isBuiltin remain unchanged)
- Updated view reflects all new field values when fetched via GET

## Acceptance criteria

- [x] `PUT /saved-views/{viewId}` route exists and is registered
- [x] Request schema requires all mutable fields (name, queryDefinition, displayConfiguration, etc.)
- [x] Request schema excludes immutable fields (id, isBuiltin, userId, createdAt, updatedAt)
- [x] Repository function `updateSavedViewByIdForUser` performs full replacement
- [x] Immutable fields (id, isBuiltin, userId, createdAt) are preserved after update
- [x] `updatedAt` is set to current timestamp
- [x] Returns 404 for non-existent view IDs
- [x] Returns 400 for builtin views (protection added)
- [x] Returns 200 with updated view on success
- [x] E2E tests pass for all cases
- [x] `turbo check` passes

## Blocked by

- [Task 01](./01-saved-views-data-model-bootstrap.md)

## User stories addressed

- User story 6 (update saved view filters, sort, display configuration)
- User story 34 (PUT semantics, full replacement)
- User story 35 (immutable fields excluded from request schema)
- User story 37 (errors follow existing Hono pattern)
