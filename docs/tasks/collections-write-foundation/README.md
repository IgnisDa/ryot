# Collections Write Foundation

## Problem Statement

Ryot V2 has a strong entity, event, relationship, and saved-view foundation, but collections are
still only partially represented. The backend already bootstraps a placeholder `Collections` saved
view, yet there is no first-class write model for creating collections, attaching entities to
them, or storing per-membership metadata.

Ryot V1 supported collection-specific extra information through collection templates and per-item
membership data. That capability is still needed in V2. Users need to create arbitrary collections
such as `Recommended to me`, define the structured information required when adding something to
that collection, and then add entities with validated metadata. Without this, collections remain a
read-side idea instead of a usable tracking feature.

The rewrite should preserve the V2 architecture rather than recreate V1's separate collection data
model. Collections should be represented using the same core primitives the platform already uses:
entities, relationships, and `AppSchema`-based validation.

## Solution

Introduce collections as a built-in entity schema and collection membership as a relationship write
model.

Each collection is stored as an entity of the built-in `collection` schema. That entity's
properties contain a `membershipPropertiesSchema` field whose value is an `AppSchema`. This schema
defines the shape of metadata that must be provided when another entity is added to the collection.

Each membership is stored as a `member_of` relationship whose source is the added entity and whose
target is the collection entity. Membership metadata is stored in `relationship.properties` and is
validated against the target collection's `membershipPropertiesSchema` before persistence.

The first implementation focuses only on the backend write side:

- create a collection
- add one or more entities to a collection
- remove one or more entities from a collection
- validate collection templates and membership properties

This implementation deliberately uses the existing V2 primitives instead of inventing a parallel
collection-only storage model. It also seeds the built-in `collection` entity schema and points the
existing built-in `Collections` saved view at that schema directly so the platform default matches
the intended long-term model.

## User Stories

1. As a user, I want to create a collection called `Recommended to me`, so that I can group items
   around a personal curation theme.
2. As a user, I want a collection to define what metadata is required when I add an item, so that
   the collection captures the context that matters for that use case.
3. As a user, I want collection membership metadata to use the same property-schema format as the
   rest of the app, so that collection behavior feels consistent with entities and events.
4. As a user, I want to add a movie to `Recommended to me` with `friendWhoRecommendedIt` and
   `whereTheyRecommendedIt`, so that I can remember both the person and the context.
5. As a user, I want required membership fields to be enforced, so that collections do not silently
   lose the information they were created to capture.
6. As a user, I want invalid membership payloads to fail before they are saved, so that the data in
   my collections stays trustworthy.
7. As a user, I want to add multiple entities to the same collection, so that collections are
   useful for more than one item.
8. As a user, I want the same entity to be addable to multiple collections, so that I can organize
   one item under different personal systems.
9. As a user, I want adding the same entity to the same collection again to update the existing
   membership instead of creating duplicates, so that corrections are simple and the collection does
   not become noisy.
10. As a user, I want removing an entity from a collection to delete the membership cleanly, so
    that the collection reflects my current organization.
11. As a user, I want collections to accept any entity type, so that collections remain a generic
    cross-tracker feature instead of a media-only feature.
12. As a user, I want to add a collection to another collection if I choose, so that the system
    does not arbitrarily block my organization model.
13. As a user, I want collection writes to work even if they create cycles, so that the backend does
    not impose traversal rules on a write-only slice.
14. As a user, I want collection membership templates to carry explicit field labels, so that the
    feature uses the current `AppSchema` contract.
15. As a user, I want the built-in `Collections` saved view to reflect the new built-in collection
    schema, so that the default platform structure matches the persisted model.
16. As a backend developer, I want collections to persist as entities, so that they use the same
    core storage primitives as the rest of the platform.
17. As a backend developer, I want collection membership to persist as relationships, so that
    collection inclusion is modeled as a first-class graph edge instead of a special-case table.
18. As a backend developer, I want membership properties to live on the relationship row, so that
    per-membership metadata stays attached to the membership itself.
19. As a backend developer, I want collection templates to be stored as `AppSchema`, so that
    collection validation aligns with entity and event validation.
20. As a backend developer, I want collection creation to validate the nested
    `membershipPropertiesSchema` value as an `AppSchema`, so that malformed templates never enter
    the database.
21. As a backend developer, I want membership writes to validate against the target collection's
    template before persistence, so that relationship properties cannot drift from the collection's
    contract.
22. As a backend developer, I want `member_of` relationships to be unique per
    `(user, source entity, target collection, relType)`, so that membership upsert semantics are
    deterministic.
23. As a backend developer, I want relationship upserts to replace membership properties with the
    newest valid payload, so that clients can safely correct earlier entries.
24. As a backend developer, I want collection writes to use collection IDs rather than collection
    names, so that future rename behavior stays safe and unambiguous.
25. As a backend developer, I want the built-in `collection` schema and `Collections` saved view to
    ship as the default model immediately, so that no transitional compatibility code is needed.
26. As a backend developer, I want object-property strictness to remain strict by default, so that
    this feature does not weaken validation across the platform.
27. As a backend developer, I want object properties to optionally allow passthrough unknown keys,
    so that `membershipPropertiesSchema` can embed a nested `AppSchema` without inventing a second
    schema format.
28. As a backend developer, I want collection-specific validation logic to live in a dedicated
    backend module, so that generic entity creation does not gain hidden collection-only behavior.
29. As a backend developer, I want collection deletion to remove memberships automatically through
    existing referential cleanup rules, so that orphaned memberships do not remain.
30. As a tester, I want end-to-end tests to exercise the public API contracts for collection
    creation and membership writes, so that the persisted behavior is protected across refactors.
31. As a tester, I want to verify that collection-in-collection and cycle writes are accepted in
    this slice, so that future traversal work starts from explicit existing behavior.
32. As a future frontend developer, I want the backend write contract settled before collection list
    and detail UX are implemented, so that the UI is built on a stable persistence model.
33. As a future query-engine developer, I want collection write semantics to be clear before
    relationship-driven collection views are added, so that read-side behavior is layered on top of
    consistent stored data.

## Implementation Decisions

### Feature scope

- This PRD covers backend write-side foundations only.
- In scope: create collection, add entities to collection, remove entities from collection,
  bootstrap the built-in collection schema, and validate both templates and membership payloads.
- Out of scope for this slice: collection listing APIs, collection detail queries, recursive
  traversal, collection editing UX, relationship-based saved-view execution, collaborator support,
  and per-user collection visibility settings.

### Canonical persistence model

- A collection is persisted as an entity of a built-in `collection` entity schema.
- Collection membership is persisted as a `member_of` relationship.
- The relationship source is the member entity.
- The relationship target is the collection entity.
- Membership metadata is stored in `relationship.properties`.

### Collection template storage

- Each collection entity stores its membership template in
  `properties.membershipPropertiesSchema`.
- The value stored there is an `AppSchema`.
- Each field definition must include its own user-facing `label` metadata.
- No separate description, default-value, or suggestion system is introduced in this slice beyond
  the required `label` metadata.

### Built-in collection schema

- The backend seeds a built-in `collection` entity schema as the default platform model.
- Collections remain user-owned entity rows even though the schema is built-in.
- The built-in `Collections` saved view is updated to target the built-in `collection` entity schema
  directly.
- Because the application is still under development and the database will be reset, the built-in
  collection model should ship as the direct default rather than through compatibility layers.

### Dedicated collection write API

- Collections persist as generic entities and relationships, but the write surface for this slice is
  a dedicated collections API.
- Collection creation should not depend on the generic entity creation contract.
- Membership writes should not depend on a generic relationships API, because that API does not yet
  exist and collection membership has collection-specific validation rules.
- Membership write endpoints should identify the target collection by `collectionId`, not by name.

### Validation model

- The collection entity schema stores `membershipPropertiesSchema` under an object property that
  preserves unknown keys rather than rejecting them.
- Object-property validation remains strict by default across the platform.
- Object properties gain an explicit unknown-key policy with a strict default and an opt-in
  passthrough mode.
- The collection schema uses passthrough behavior only for `membershipPropertiesSchema` so the
  nested schema object survives generic entity-property validation.
- The collections module separately validates `membershipPropertiesSchema` as a real `AppSchema`
  before persisting a collection.
- The collections module validates `relationship.properties` against the target collection's stored
  `membershipPropertiesSchema` before creating or updating a membership.
- Membership validation should reuse the same property-schema parsing and `AppSchema` runtime used
  by entities and events rather than introducing a collection-only validation engine.

### Membership write semantics

- The relationship type for collection membership is `member_of`.
- There is exactly one membership row for a given `(user, source entity, target collection,
  relType)` combination.
- Adding an entity to a collection behaves as an upsert.
- A repeated add to the same collection replaces the existing membership properties with the newest
  validated payload.
- Removing an entity from a collection deletes the matching `member_of` relationship.
- Bulk add and bulk remove support may share the same underlying contract even if the initial
  frontend uses only a small subset of it.

### Addability and cycles

- Any entity type can be added to a collection, including another collection entity.
- Collection-to-collection membership is allowed in this slice.
- Cycles are allowed in this slice.
- No recursive querying, expansion, or cycle detection is part of the write implementation.
- Future read-side features that traverse collection graphs must be explicitly cycle-safe.

### Ownership and access control

- The acting user may only create collection entities for themselves.
- The acting user may only add members to collections they own.
- The acting user may only remove memberships from collections they own.
- The acting user may only create memberships for entities they are allowed to view.
- Relationship rows record the acting user as the owner of the membership write.

### Delete semantics

- Deleting a collection entity removes its memberships through referential cleanup or explicit
  relationship cleanup in the same write path.
- No separate archival or soft-delete behavior is introduced in this slice.

### Deep modules to build or modify

- A collection write service that owns collection-template parsing, membership validation, access
  checks, and write orchestration.
- A collection repository layer for creating collection entities and upserting or deleting
  membership relationships.
- Shared property-schema infrastructure extended with object unknown-key policies while remaining
  strict by default.
- Bootstrap manifest logic extended to seed the built-in `collection` entity schema and align the
  built-in `Collections` saved view with it.

## Testing Decisions

A good test exercises observable behavior through a public contract and avoids coupling assertions to
internal implementation details. Collection tests should assert what is persisted, returned, or
rejected through the public API surface rather than how the service composes repository calls.

### Required end-to-end coverage

This feature requires end-to-end tests in `tests/src/`. These tests are mandatory, not optional.
They should follow the existing API-first test style used by the current backend suites.

The e2e suite should cover at least:

- creating a collection with a valid `membershipPropertiesSchema`
- rejecting collection creation when `membershipPropertiesSchema` is not a valid `AppSchema`
- adding an entity to a collection with valid membership properties
- rejecting membership writes when required membership fields are missing or invalid
- upserting an existing membership instead of creating duplicates
- removing an entity from a collection
- allowing a collection to be added to another collection
- allowing a cycle write in this slice
- preventing one user from mutating another user's collection

Prior art for API-level tests is the existing end-to-end suite structure around entity creation,
event creation, saved views, and query behavior.

### Backend module tests

The backend should also add focused tests for pure or narrow logic where that produces durable
coverage with low setup cost.

Recommended targets:

- object-property unknown-key policy parsing and runtime behavior
- collection template parsing as `AppSchema`
- membership payload validation against a stored template
- access-control helpers for collection ownership and visible-entity checks
- membership upsert semantics in the service layer when the repository contract is mocked

Prior art is the existing pure service and schema-validation test style used across the backend for
entities, events, property schemas, and saved views.

### Test quality bar

- Test only externally visible behavior.
- Prefer small pure tests for validation and decision logic.
- Use end-to-end tests to verify contracts, persistence, and access control.
- Avoid testing internal helper composition unless a helper itself is the public behavior being
  promised.

## Out of Scope

- Collection listing endpoints
- Collection detail endpoints
- Relationship-query execution in the view runtime
- Recursive collection traversal or aggregate reads
- Collaborators and per-user hidden state
- Template labels, descriptions, defaults, suggestions, and other V1 sugar beyond `AppSchema`
- Automatic accumulation of string suggestions from prior membership values
- Frontend collection creation or add-to-collection UX
- Editing existing collection definitions after creation
- Dedicated collection analytics or overview counts

## Further Notes

- The design intentionally keeps collection semantics distinct from built-in media lifecycle
  actions. Backlog, progress, complete, and review remain event semantics rather than default
  collections.
- The write model should favor the smallest correct implementation and avoid speculative read-side
  abstractions.
- Because field labels now live in explicit `label` metadata, future UX work should preserve a
  straightforward migration path to richer schema metadata without invalidating stored membership
  payloads.
- This slice settles the persistence and validation model first so later collection browsing and
  editing work can build on a stable backend contract.

---

## Tasks

**Overall Progress:** 0 of 4 tasks completed

**Current Task:** [Task 01](./01-collection-schema-and-bootstrap-foundation.md) (todo)

### Task List

| # | Task | Type | Status | Blocked By |
|---|------|------|--------|------------|
| 01 | [Collection Schema And Bootstrap Foundation](./01-collection-schema-and-bootstrap-foundation.md) | AFK | todo | None |
| 02 | [Create Collection With Membership Template Validation](./02-create-collection-with-membership-template-validation.md) | AFK | todo | Task 01 |
| 03 | [Add Or Update Collection Memberships](./03-add-or-update-collection-memberships.md) | AFK | todo | Task 02 |
| 04 | [Remove Memberships And Harden Write Access](./04-remove-memberships-and-harden-write-access.md) | AFK | todo | Task 03 |
