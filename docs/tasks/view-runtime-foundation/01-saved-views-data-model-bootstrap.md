# Saved Views Data Model & Bootstrap Update

**Parent Plan:** [View Runtime Foundation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Expand the saved views data model to store both query semantics and presentation configuration, and update bootstrap manifests to produce the richer saved-view structure. This is the foundation that all other tasks depend on.

The end-to-end behavior: after this task, the application boots successfully with built-in saved views that contain `displayConfiguration` and an expanded `queryDefinition` (with `entitySchemaSlugs`, `filters`, `sort`). The existing list and create endpoints continue to work with the new structure. All existing tests pass.

### Database Migration

Add `display_configuration` column to the `saved_view` table:
- Type: `jsonb NOT NULL`
- Structure: `{ layout: "grid" | "list" | "table", grid: {}, list: {}, table: {} }`
- See PRD section "Database Schema Changes" for full details

Expand `query_definition` jsonb structure:
- Current: `{ entitySchemaIds: string[] }` (uses UUIDs)
- New: `{ entitySchemaSlugs: string[], filters: FilterExpression[], sort: SortDefinition }`
- Uses slugs instead of IDs for portability and readability
- Breaking change acceptable (application not in production, wipe and re-bootstrap)

No data migration is required. Existing saved views will be wiped and rebuilt from scratch during bootstrap. See PRD section "Migration Strategy."

### Zod Schema Updates

Update `apps/app-backend/src/modules/saved-views/schemas.ts`:

- `SavedViewQueryDefinition` expands to include `entitySchemaSlugs: string[]`, `filters: FilterExpression[]`, `sort: SortDefinition`
- New `DisplayConfiguration` schema with discriminated union for layouts (grid/list/table)
- New `FilterExpression` discriminated union by operator type (see PRD section "Filter operator discriminated union")
- Request/response schemas for saved view creation updated to include new fields
- See PRD sections "Saved Views Module Changes > Schema updates" and "View Runtime Module Changes > Filter operator discriminated union"

### Repository Type Casting

Update `apps/app-backend/src/modules/saved-views/repository.ts`:
- Maintain existing type casting pattern for JSONB columns
- `SavedViewRow = Omit<ListedSavedView, "queryDefinition" | "displayConfiguration"> & { queryDefinition: unknown, displayConfiguration: unknown }`
- Trust database for type correctness (no runtime Zod validation)
- See PRD section "Type casting pattern"

### Bootstrap Manifest Updates

Update `apps/app-backend/src/modules/authentication/bootstrap/manifests.ts`:
- Add hardcoded display configuration to all built-in saved views (All Books, All Animes, All Mangas, Collections)
- Update `queryDefinition` to use new structure with `entitySchemaSlugs` (slugs instead of IDs)
- See PRD section "Bootstrap Updates" for the exact hardcoded config

Update `apps/app-backend/src/modules/authentication/service.ts`:
- Ensure bootstrap creates saved views with new column structure

### Known Issue

The hardcoded `@image` in bootstrap configs returns the full jsonb discriminated union object, not a URL. This is acceptable per the PRD. Full bootstrap implementation deferred to Phase 2.

## Acceptance criteria

- [ ] Database migration adds `display_configuration` jsonb NOT NULL column to `saved_view` table
- [ ] `query_definition` jsonb structure uses `entitySchemaSlugs` (not `entitySchemaIds`)
- [ ] Zod schemas define `SavedViewQueryDefinition`, `DisplayConfiguration`, `FilterExpression`, and `SortDefinition`
- [ ] `FilterExpression` uses discriminated union by operator type (`isNull` accepts no value, `in` requires array, others accept single value)
- [ ] Repository type casting handles both `queryDefinition` and `displayConfiguration` JSONB columns
- [ ] Bootstrap manifests include hardcoded `displayConfiguration` for all built-in views
- [ ] Bootstrap manifests use `entitySchemaSlugs` in `queryDefinition`
- [ ] Application boots successfully (no migration or type errors)
- [ ] Existing `GET /saved-views` and `POST /saved-views` endpoints work with new structure
- [ ] Existing `DELETE /saved-views/{viewId}` endpoint continues to work
- [ ] All existing tests pass
- [ ] `turbo check` passes (no type errors)

## Blocked by

None - can start immediately

## User stories addressed

- User story 1 (save view with multiple layout configurations)
- User story 31 (JSONB type casting in repository)
- User story 48 (hardcoded bootstrap display configs)
- User story 49 (trust frontend for validation in Phase 1)
