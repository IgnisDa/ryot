## Problem Statement

The entity import flow is currently implemented as a media-specific worker with hardcoded dispatch branches for special entity types. A user imports an entity by sending a script id, external id, and entity schema id, but once the job reaches the worker, the implementation switches on media-specific job names and calls separate handlers for people, companies, and media groups. This makes the import path harder to extend because the backend needs to know every special related entity type in advance.

The sandbox scripts already know the provider-specific structure of imported data. A details script can return the primary entity data and can also identify other importable entities that should be written as separate global entity rows with relationship rows back to the primary entity. Those related rows should be placeholders until they are imported directly through the same import endpoint with their own script id, external id, and entity schema id.

The current design causes generic entity import behavior to be spread across media-specific code, special populate jobs, hardcoded relationship-schema resolution, and script-specific property names such as people, companies, and groups. The refactor should make entity import generic while preserving the existing public import endpoint and current greenfield freedom to break old internal script contracts.

## Solution

Refactor the import worker into a generic entity import processor. The import job will continue to receive the same identity tuple: user id, script id, external id, and entity schema id. The worker will run the sandbox details driver for that script and external id, validate the returned primary properties against the requested entity schema, create or update the primary global entity row, add it to the user's library, and set the primary entity's populated timestamp.

Sandbox details scripts will be migrated to return generic related entity references in a top-level related entities collection. Each related entity reference will contain only related entity identity and relationship properties. It will not contain related entity properties. The backend will resolve the related script from the reference script slug, derive the related entity schema from that script's provider association, derive the relationship schema from the related entity schema and primary entity schema, create or update the related global entity row with populated timestamp left null, and write the relationship row.

The import flow will no longer enqueue person, company, or group populate jobs. Related entities can later be fully populated by calling the same import endpoint directly with the related entity's script id, external id, and entity schema id.

## User Stories

1. As a user importing a media item, I want the import endpoint to populate the selected item, so that I can add real provider-backed entities to my library.
2. As a user importing a media item, I want related people, companies, and groups to be written as separate entity rows, so that relationship-backed views can show structured related data.
3. As a user importing a book, I want author references to become related person entities, so that author relationships are queryable.
4. As a user importing a movie, I want cast and crew references to become related person entities, so that people-to-movie relationships are queryable.
5. As a user importing a game, I want developers and publishers to become related company entities, so that company relationships are queryable.
6. As a user importing music, I want artists and album references to become related entities, so that music relationships are queryable.
7. As a user importing an audiobook, I want authors, narrators, and series references to become related entities, so that audiobook metadata is normalized.
8. As a user importing a comic book, I want series and creator references to become related entities when provider identity is available, so that comic relationships are queryable.
9. As a user importing a podcast, I want unlinked publisher or creator strings to stay on the podcast properties, so that non-importable creator data is not incorrectly modeled as an entity.
10. As a user importing an item whose provider returns name-only creators, I want those creators to remain normal properties, so that the import does not create low-quality placeholder entities without provider identity.
11. As a user, I want related placeholder entities to be importable later through the same endpoint, so that any related entity can be expanded into full details on demand.
12. As a user, I want related placeholder entities to remain unpopulated until imported directly, so that later full imports are not skipped incorrectly.
13. As a user, I want duplicate imports of the same primary entity to reuse the existing global entity, so that global provider identity stays stable.
14. As a user, I want duplicate related references to reuse existing related entity rows, so that the database does not accumulate duplicate people, companies, or groups.
15. As a user, I want relationship properties such as roles, character names, and display order to be stored on relationship rows, so that edge-specific metadata is queryable.
16. As a user, I want relationship properties from the latest import to replace previous relationship properties, so that provider updates can correct relationship metadata.
17. As a user, I want import failures to be visible when required relationship schemas are missing, so that broken seeded manifests do not silently drop data.
18. As a script author, I want one generic related entity contract, so that I do not need to know about backend-specific people, company, or group worker branches.
19. As a script author, I want unlinked creators to remain ordinary schema properties, so that scripts can continue returning name-only creator metadata without fake entity identities.
20. As a backend maintainer, I want one import processor, so that adding a new entity type does not require adding a new worker branch.
21. As a backend maintainer, I want the backend to derive related entity schemas from sandbox script metadata, so that scripts do not need environment-specific database ids.
22. As a backend maintainer, I want relationship schemas to be derived from source and target entity schemas, so that scripts do not need to return relationship schema ids or slugs.
23. As a backend maintainer, I want every related entity reference to include a name, so that placeholder rows always have a display label.
24. As a backend maintainer, I want scripts to provide a placeholder name such as Loading... only when no better provider name is available, so that generic validation can stay strict.
25. As a backend maintainer, I want scripts to aggregate duplicate related references before returning them, so that overwrite-only relationship writes do not lose roles or other edge metadata.
26. As a backend maintainer, I want all details scripts to use the same output shape, so that import result validation is predictable.
27. As a backend maintainer, I want old related fields such as people, companies, and groups removed from persisted entity properties, so that relationship data is no longer duplicated inside entity properties.
28. As a backend maintainer, I want the existing import endpoint to remain in place, so that API consumers can keep importing entities with the same public identity tuple.
29. As a backend maintainer, I want the current queue name and worker module to keep working during the refactor, so that the implementation can stay focused while leaving naming cleanup for later.
30. As a test maintainer, I want E2E coverage for related entity and relationship creation, so that the generic import behavior is verified through the public API.
31. As a test maintainer, I want the existing OpenLibrary import E2E test to continue passing, so that the current no-API-key import path remains covered.
32. As a test maintainer, I want the OpenLibrary author reference gap fixed, so that the generic related entity contract is enforced even for the existing E2E provider.
33. As a future implementation agent, I want the PRD to define all contract and overwrite decisions, so that the refactor does not require rediscovering the design.

## Implementation Decisions

- The public import endpoint remains the entity schema import endpoint and continues accepting script id, external id, and entity schema id.
- The import job payload remains user id, script id, external id, and entity schema id.
- The existing queue and job name may remain named as media import for this refactor.
- Add a TODO comment near the retained job naming stating that the name should later change to reflect generic entity import behavior.
- The existing worker module may remain in the media module for this refactor.
- Add a TODO comment near the retained worker/module boundary stating that the worker should later move to a generic entity import module.
- The import worker should no longer dispatch to person, company, or group populate handlers.
- The import worker should have one generic details-processing path for all imported entity schemas.
- Backward compatibility with old script result shapes is not required.
- All details scripts must be updated to the new contract in the same refactor.
- The new details result contract contains a primary entity name, primary entity properties, and an optional top-level related entities collection.
- The primary entity name is required.
- The primary entity properties object is required and remains the only source of properties for the primary entity row.
- The related entities collection is optional and defaults to empty when absent.
- Each related entity reference must contain name, external id, script slug, and relationship properties.
- Related entity references must not contain related entity properties.
- Related entity names are required.
- Scripts must use a placeholder name such as Loading... when an importable related entity does not have a reliable provider name.
- Unlinked creators are not related entities and must remain normal primary entity properties when the entity schema supports them.
- Provider suggestions are ignored for this refactor.
- Old script properties named people, companies, and groups should be removed from primary entity properties and replaced by generic related entity references.
- Any old person or company role field should become part of relationship properties, not related entity identity.
- Current person or company role values should be represented as a roles array inside relationship properties.
- Current person character and order values should also be represented inside relationship properties when available.
- Current group references should use relationship properties containing a member-style role value.
- Relationship properties are edge metadata only and are stored on relationship rows.
- Related entity identity is limited to name, external id, and resolved script/schema information.
- The backend resolves the related sandbox script by script slug.
- The backend derives the related entity schema from the resolved sandbox script's existing provider association.
- Scripts must not return database ids for scripts, entity schemas, or relationship schemas.
- The backend derives the relationship schema from related entity schema as source and primary imported entity schema as target.
- The relationship row direction is related entity as source and primary entity as target.
- Missing related sandbox scripts should fail the import job.
- Missing related entity schema associations should fail the import job.
- Missing relationship schemas should fail the import job.
- Invalid primary properties should fail the import job.
- Invalid relationship properties should fail the import job.
- Related entity rows are global rows, matching the current imported entity provenance model.
- Related entity rows are created or reused by external id, related entity schema id, and related sandbox script id.
- Related entity rows created from related references must keep populated timestamp null.
- Related entity rows should store the related reference name and provenance fields.
- Related entity rows should not store properties from related references because the contract does not include them.
- Fully importing a related entity later through the same endpoint is responsible for setting its properties, image, name, and populated timestamp.
- The primary imported entity should be added to the authenticated user's library as it is today.
- Related placeholder entities should not automatically be added to the authenticated user's library.
- The primary import should still short-circuit when an existing populated global entity already exists for the same provenance, while still ensuring library membership for the importing user.
- Existing unpopulated rows for the primary provenance should be eligible for population by the current import.
- Relationship writes use one row per source entity, target entity, and relationship schema.
- Relationship properties are always overwritten by the latest import result for that relationship row.
- Relationship properties should not be merged by the backend.
- Scripts must aggregate duplicate related references for the same related entity before returning them when multiple roles or edge attributes need to be preserved.
- If a script returns duplicate related entity references for the same relationship, last write wins is acceptable backend behavior.
- The current role-specific relationship writer should be replaced or bypassed with a generic writer that validates and overwrites relationship properties.
- Relationship property validation remains schema-driven using the resolved relationship schema.
- Primary entity property validation remains schema-driven using the requested entity schema.
- Images on the primary entity continue to be derived from the validated primary properties where supported.
- Removing old special populate jobs means old person, company, and group job payload schemas and handlers become dead code and should be removed as part of the refactor.
- Script result validation should be strict enough to catch missing related entity names, missing external ids, missing script slugs, and invalid relationship property objects.
- The OpenLibrary book details script must be updated so linked author references include a name.
- All details scripts that currently emit people, companies, or groups must be migrated to emit related entities.
- Details scripts that currently emit no related entities only need to continue returning primary name and properties.

## Testing Decisions

- Tests should verify external behavior through public APIs and persisted data, not private worker implementation details.
- Existing import endpoint tests should continue covering authentication, missing job, cross-user job isolation, successful enqueue, successful polling, populated properties, and populated timestamp behavior.
- Existing import endpoint tests currently use a no-API-key OpenLibrary book provider and should continue using that provider for the main import flow.
- Add E2E coverage that imports an OpenLibrary book and verifies author references become related entity rows and relationship rows.
- The OpenLibrary E2E test should verify related author placeholder rows have populated timestamp null.
- The OpenLibrary E2E test should verify the primary imported book has populated timestamp set.
- The OpenLibrary E2E test should verify the primary book properties no longer include a people collection after migration.
- The OpenLibrary E2E test should verify unlinked creators, when present for schemas that support them, remain normal properties rather than related entities.
- The OpenLibrary E2E test should verify the relationship row uses related person as source and imported book as target.
- The OpenLibrary E2E test should verify relationship properties contain the expected roles array for authors.
- The OpenLibrary E2E test should verify relationship properties are schema-valid.
- Add focused backend tests for the generic import result parser and related entity validation.
- Add focused backend tests for relationship overwrite behavior.
- Relationship overwrite tests should confirm incoming properties replace prior properties instead of merging roles or other fields.
- Add focused backend tests for missing related script, missing related schema association, missing relationship schema, and invalid relationship properties.
- Add tests for duplicate related references if the generic processor includes explicit duplicate handling; otherwise rely on script-level aggregation and document last-write-wins behavior.
- Add or update tests for sandbox script migration where practical by asserting scripts produce the new related entity shape through import behavior rather than testing script internals directly.
- Existing sandbox execution tests should not need changes unless the raw sandbox result contract used by those tests is changed.
- Existing media group schema tests should continue validating seeded group schemas and providers.
- The standalone seed script uses the import/search flow and should be updated if import result or script result expectations change.
- Prior art for API-level test structure is the existing entity schema import/search E2E test suite.
- Prior art for direct database relationship assertions is the existing test fixtures that seed and query media relationships.

## Out of Scope

- Renaming the queue, job, or worker module from media terminology to generic entity import terminology.
- Moving the worker into a new generic import module.
- Supporting backward compatibility for old script result fields such as people, companies, and groups.
- Returning or preserving provider suggestions.
- Treating unlinked creators as entities.
- Allowing related entity references to include partial related entity properties.
- Recursively importing related entities inside the primary import job.
- Adding new public import endpoints.
- Adding database tables or columns for this refactor.
- Automatically adding related placeholder entities to a user's library.
- Changing search driver behavior.
- Changing event lifecycle behavior for imported media.
- Changing saved-view or query-engine relationship semantics.

## Further Notes

- The refactor depends on all details scripts using one generic related entity contract. Keeping a backend adapter for old people, companies, and groups fields would preserve the old special-type coupling in a different place.
- The no-merge relationship decision means scripts own aggregation of roles and other edge metadata before returning related entities.
- The OpenLibrary tracer bullet now resolves linked author names and the E2E test pins the provider-backed author plus the related entity and relationship rows.
- The final cleanup task generated from this PRD should include removing dead dispatcher code, old special populate job definitions, stale tests, and any unused media-specific helper schemas that only existed for the old worker design.

---

## Tasks

**Overall Progress:** 6 of 6 tasks completed

**Current Task:** [Task 06](./06-codebase-cleanup.md) (done)

### Task List

| #   | Task                                                                                                  | Type | Status |
| --- | ----------------------------------------------------------------------------------------------------- | ---- | ------ |
| 01  | [OpenLibrary Generic Import Tracer Bullet](./01-openlibrary-generic-import-tracer-bullet.md)          | AFK  | done   |
| 02  | [Generic Import Validation And Relationship Overwrite](./02-generic-import-validation-and-relationship-overwrite.md) | AFK  | done   |
| 03  | [Migrate All Provider Details Scripts](./03-migrate-all-provider-details-scripts.md)                  | AFK  | done   |
| 04  | [Remove Special Populate Dispatchers](./04-remove-special-populate-dispatchers.md)                    | AFK  | done   |
| 05  | [Update E2E Fixtures And Seed Script](./05-update-e2e-fixtures-and-seed-script.md)                    | AFK  | done   |
| 06  | [Codebase Cleanup](./06-codebase-cleanup.md)                                                          | AFK  | done   |
