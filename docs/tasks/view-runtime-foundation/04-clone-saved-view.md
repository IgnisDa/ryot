# Clone Saved View

**Parent Plan:** [View Runtime Foundation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add a `POST /saved-views/{viewId}/clone` endpoint that creates a copy of an existing saved view. The clone operation is a pure copy with no request body. It appends " (Copy)" to the name and sets `isBuiltin: false` so cloned views are always deletable.

The end-to-end behavior: a client sends `POST /saved-views/{viewId}/clone` and receives a new saved view that is an exact copy of the original, with a new ID, " (Copy)" appended to the name, and `isBuiltin` set to `false`.

### Route Handler

Add to `apps/app-backend/src/modules/saved-views/routes.ts`:
- `POST /saved-views/{viewId}/clone` route
- No request body required
- Returns 404 for non-existent views
- Returns 200 with the newly cloned view
- See PRD section "Saved Views Module Changes > New endpoints"

### Repository Function

Add to `apps/app-backend/src/modules/saved-views/repository.ts`:
- `cloneSavedViewByIdForUser(viewId, userId)` function
- Field transformations per PRD section "Clone Behavior":
  - `id`: New UUID generated
  - `name`: Original name + " (Copy)" (no smart numbering)
  - `isBuiltin`: Always set to `false`
  - `userId`: Set to authenticated user
  - `createdAt`, `updatedAt`: Set to current timestamp
  - All other fields (icon, accentColor, trackerId, queryDefinition, displayConfiguration): Copied as-is
- Returns new view or undefined if source not found

### E2E Tests

Add to `tests/src/tests/`:
- `POST /saved-views/{viewId}/clone` creates copy with " (Copy)" appended to name
- `POST /saved-views/{viewId}/clone` sets `isBuiltin` to `false` (even when cloning built-in view)
- `POST /saved-views/{viewId}/clone` generates new ID (different from source)
- `POST /saved-views/{viewId}/clone` preserves queryDefinition and displayConfiguration
- `POST /saved-views/{viewId}/clone` returns 404 for non-existent view
- Cloning a clone produces "Name (Copy) (Copy)" (no smart numbering)

## Acceptance criteria

- [ ] `POST /saved-views/{viewId}/clone` route exists and is registered
- [ ] No request body required
- [ ] Cloned view has new UUID, different from source
- [ ] Cloned view name has " (Copy)" appended
- [ ] Cloned view `isBuiltin` is always `false`
- [ ] Cloned view preserves queryDefinition and displayConfiguration from source
- [ ] Cloned view has current timestamps for createdAt and updatedAt
- [ ] Returns 404 for non-existent source view
- [ ] E2E tests pass for all cases
- [ ] `turbo check` passes

## Blocked by

- [Task 01](./01-saved-views-data-model-bootstrap.md)

## User stories addressed

- User story 5 (clone existing saved view)
- User story 32 (clone appends " (Copy)" without smart numbering)
- User story 33 (clone sets isBuiltin to false)
- User story 37 (errors follow existing Hono pattern)
