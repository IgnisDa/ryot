# Reserved Slug Validation

**Parent Plan:** [View Runtime Foundation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add validation that prevents custom entity schemas from using slugs reserved by built-in schemas. The list of reserved slugs is derived from bootstrap manifests as the single source of truth. Entity schema slugs are treated as immutable after creation.

The end-to-end behavior: when a user attempts to create a custom entity schema with a slug that matches a built-in schema (e.g., "book", "anime", "manga"), the creation fails with a validation error. Non-reserved slugs continue to work normally.

### Validation Function

Add to `apps/app-backend/src/modules/entity-schemas/service.ts`:
- `validateSlugNotReserved(slug: string): void` function
- Import built-in entity schemas from `apps/app-backend/src/modules/authentication/bootstrap/manifests.ts`
- Derive reserved slugs: `builtinEntitySchemas.map(s => s.slug)`
- Throw validation error if slug matches any reserved slug
- See PRD section "Reserved Slug Validation"

### Hook Into Creation Flow

Update entity schema creation in `apps/app-backend/src/modules/entity-schemas/service.ts` or `routes.ts`:
- Call `validateSlugNotReserved` during entity schema creation validation
- This runs before the database insert
- Existing slug generation (kebab-case from name) may produce reserved slugs

### Schema Immutability

No slug update endpoint exists (and none should be added). The immutability guarantee is already implicit in the current API surface. This task confirms that guarantee by documenting it and testing the reserved slug case. See PRD section "Schema Immutability."

### Unit Tests

Add to or create `apps/app-backend/src/modules/entity-schemas/service.test.ts`:
- Throws error for each built-in schema slug (book, anime, manga)
- Does not throw for non-reserved slugs (e.g., "smartphones", "custom-schema")
- Reserved list is derived from manifests (not hardcoded in test)
- Follow the pattern in `apps/app-backend/src/modules/saved-views/service.test.ts`

## Acceptance criteria

- [ ] `validateSlugNotReserved` function exists in entity-schemas service
- [ ] Reserved slug list is derived from bootstrap manifests (single source of truth)
- [ ] Creating entity schema with slug "book" fails with validation error
- [ ] Creating entity schema with slug "anime" fails with validation error
- [ ] Creating entity schema with slug "manga" fails with validation error
- [ ] Creating entity schema with non-reserved slug succeeds
- [ ] Validation is called during entity schema creation flow
- [ ] Unit tests cover all built-in slugs and non-reserved slugs
- [ ] Existing entity schema tests pass
- [ ] `turbo check` passes

## Blocked by

- [Task 01](./01-saved-views-data-model-bootstrap.md)

## User stories addressed

- User story 9 (entity schema slugs immutable after creation)
- User story 10 (built-in slugs reserved, custom schemas cannot conflict)
- User story 42 (reserved slug list derived from bootstrap manifests)
