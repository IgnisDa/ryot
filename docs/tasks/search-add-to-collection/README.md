# Search Add To Collection

## Problem Statement

The external entity search modal already lets users search, import, and take media lifecycle
actions on results, but the `Collection` action is still disabled even though the backend write
contract for collection memberships now exists.

This leaves a gap in the search-to-curation flow. A user who discovers something through search can
add it to their library or backlog, but cannot immediately place it into one of their personal
collections such as `Recommended to me`, `Favorites`, or `Trip planning`. That makes collections
feel disconnected from one of the most important acquisition surfaces in the product.

The missing behavior is especially noticeable because collections are meant to be a cross-tracker,
personal-curation feature. Search is where users discover and import items quickly; if collections
cannot participate there, users are forced into a slower multi-step workflow after import.

## Solution

Enable the `Collection` action inside the expanded search-result row as an inline secondary action.

When a user chooses the action, the row opens an inline collection panel that:

- loads the user's existing collections through the existing frontend read path
- lets the user choose a target collection
- renders any required membership metadata fields using the collection template's explicit `label`
  metadata
- saves the result by first ensuring the searched item exists as an entity and then writing the
  collection membership

The flow should be intentionally write-focused. It should not attempt to provide a full membership
browser or per-result collection-state summary, because the current read side does not expose that
capability cleanly yet.

If the user has no collections, the panel should not create one inline. Instead, it should explain
that the user needs a collection first and guide them to the built-in Collections view so they can
create one there.

## User Stories

1. As a user, I want to save a search result directly to a collection, so that discovery and
   curation happen in one flow.
2. As a user, I want the collection action to live alongside the existing search-result quick
   actions, so that the feature feels like part of the same workflow rather than a separate screen.
3. As a user, I want the collection action to remain secondary to the main `Add` action, so that
   the search row stays fast for common import flows.
4. As a user, I want saving to a collection to implicitly add the item to my library if it is not
   already present, so that I do not have to perform two separate actions.
5. As a user, I want the collection action to open inline within the expanded row, so that I can
   stay in context while deciding where to save the item.
6. As a user, I want to choose from my existing collections in that inline panel, so that I can
   file the item immediately.
7. As a user, I want the panel to show a loading state while collections are being fetched, so that
   the interface does not feel broken.
8. As a user, I want the panel to show a clear empty state when I have no collections, so that I
   understand why I cannot continue.
9. As a user, I want the empty state to guide me to the built-in Collections view, so that I know
   where to create a collection first.
10. As a user, I do not want inline collection creation in the search modal, so that the search
    interaction stays focused and lightweight.
11. As a user, I want collection membership fields to display the labels defined by the collection
    template, so that the form feels intentional and readable.
12. As a user, I want collections with no membership template to be savable without extra fields,
    so that simple collections stay fast to use.
13. As a user, I want required membership fields to block submission until they are complete, so
    that I do not accidentally save incomplete metadata.
14. As a user, I want validation errors to appear in the panel before or alongside save failure, so
    that I can correct them quickly.
15. As a user, I want collection saves to use upsert semantics, so that saving the same item to the
    same collection again updates the membership instead of creating noise.
16. As a user, I want the submit button to communicate save semantics rather than one-time add
    semantics, so that repeated corrections feel natural.
17. As a user, I want a success message that names the collection I saved to, so that I can confirm
    the action landed in the right place.
18. As a user, I want a partial-failure message when the item was imported but the collection save
    failed, so that I know what did and did not happen.
19. As a user, I do not want collection saving to be conflated with media lifecycle actions such as
    backlog or review, so that my personal curation stays distinct from tracker state.
20. As a user, I want the panel to support one collection target at a time, so that the interaction
    stays simple and predictable.
21. As a user, I want to repeat the action to save the same item to another collection, so that one
    item can still belong to multiple collections.
22. As a user, I do not want the row to pretend it knows all my existing memberships for a result,
    so that the UI does not imply state that the backend has not exposed.
23. As a user, I want the search row to remain responsive while a collection save is in progress,
    so that I understand which action is pending.
24. As a user, I want the collection action to work for any entity schema that already supports the
    external search modal, so that collections remain a cross-tracker feature.
25. As a user, I want the no-collections guidance to take me to the correct built-in Collections
    view route for my account, so that I do not land on a dead end.
26. As a frontend developer, I want to reuse the existing query engine and saved-view infrastructure
    to discover collections, so that this feature does not require a new backend read contract.
27. As a frontend developer, I want collection-save orchestration to compose existing entity
    creation and membership-write flows, so that the implementation stays aligned with the current
    architecture.
28. As a frontend developer, I want membership field rendering to align with the app's existing
    generated-property patterns, so that schema-backed UI stays consistent.
29. As a frontend developer, I want the no-collections CTA to resolve the Collections saved view
    dynamically, so that the feature does not depend on hardcoded saved-view identifiers.
30. As a tester, I want the feature covered at the interaction and form-logic level, so that future
    search-modal changes do not silently break collection saves.

## Implementation Decisions

### Feature scope

- This PRD covers the frontend UX for saving a searched item to a collection from the existing
  external search modal.
- In scope: collection discovery for the modal, inline collection panel UX, membership metadata
  entry, save orchestration, success and failure handling, and no-collections guidance.
- Out of scope: new backend collection read endpoints, inline collection creation from search,
  collection membership browsing, and relationship-driven collection read surfaces.

### Entry point and interaction model

- The existing disabled `Collection` quick action becomes enabled within the expanded search-result
  row.
- The action opens an inline panel in the same row rather than a separate modal.
- The panel behaves as a sibling interaction to the existing log and review panels, preserving the
  current search-result interaction pattern.
- The collection action remains secondary and should not replace the row's primary `Add` or
  `Queue` action.

### Collection discovery

- The frontend should discover available collections through the existing generic read stack rather
  than by adding a dedicated collection-list API.
- Collection entities should be queried using the built-in `collection` schema through the current
  query execution path.
- Collection discovery should return enough information to populate the selector and access each
  collection's `membershipPropertiesSchema`.
- Collection fetching should be scoped to the authenticated user's visible data, matching the
  current generic entity-query behavior.

### No-collections guidance

- If collection discovery returns zero collections, the panel should render a calm empty state
  rather than a broken form.
- The empty state should explain that the user must create a collection first.
- The CTA should navigate to the built-in Collections saved view.
- The destination should be resolved dynamically through the existing saved-view data available to
  the frontend, not by hardcoding an opaque identifier.

### Membership form behavior

- Selecting a collection should determine whether membership fields need to be rendered.
- Membership fields should use the collection template's explicit `label` metadata for all visible
  copy.
- This slice should support the same flat primitive field shapes currently produced by the existing
  collection-creation UI.
- Collections with no membership template should show only the collection selector and save action.
- Required fields should be enforced in the frontend form before submission, while still relying on
  backend validation as the source of truth.
- Unsupported richer schema constructs are not introduced in this slice.

### Save orchestration

- Saving to a collection should first ensure the search result exists as an entity using the
  existing search-import flow.
- Once the entity exists, the frontend should call the dedicated collection-membership write
  contract with the selected collection and validated membership properties.
- The submit action should use save-oriented copy because membership writes are upserts.
- A single submission targets one collection at a time.

### Success, error, and partial-failure states

- A successful save should close the collection panel, preserve the row context, and show a success
  notification that includes the target collection name.
- If entity creation succeeds but the membership write fails, the user should receive a partial-
  failure message that makes it clear the item is in the library but not yet saved to the
  collection.
- Validation or write failures should surface within the current row interaction rather than
  redirecting the user elsewhere.
- Pending-state UI should make it clear that the collection action is in progress without blocking
  unrelated search browsing more than necessary.

### Membership-state display

- This feature should not attempt to display authoritative existing collection-membership state for
  each search result.
- The row should not claim that an item is already in a particular collection unless that state has
  been established by the current interaction.
- The collection action should therefore avoid a permanent single `done` badge model like backlog or
  review, because one entity can belong to many collections and the current read side does not
  enumerate that set.

### Relationship to lifecycle actions

- Collection saves remain distinct from media lifecycle actions such as backlog, progress, complete,
  and review.
- The UI should preserve that distinction in layout, copy, and state handling.
- No collection-specific shortcut should alter lifecycle behavior, and no lifecycle action should be
  reinterpreted as collection membership.

### Modules to build or modify

- Search modal orchestration should expand to manage collection-panel state, collection-save
  submission, and partial-failure handling.
- Search-result row UI should gain the enabled collection action and the inline collection panel.
- A collection-focused frontend read/write layer should encapsulate collection discovery for the
  modal, membership save calls, and saved-view resolution for the no-collections CTA.
- A schema-backed membership form helper should translate collection templates into initial values,
  validation rules, and generated inputs using template labels.
- Shared generated-property rendering may be extended or adapted where that produces a smaller,
  consistent implementation.

## Testing Decisions

A good test should verify externally visible behavior, form semantics, and user-facing state
transitions rather than internal React implementation details. The goal is to protect the collection
save workflow as a user experiences it: choosing a collection, filling required metadata, saving,
handling errors, and navigating to create a collection when none exist.

### Modules with tests

- Collection membership form helpers should be tested for default values, required-field handling,
  label usage, and payload shaping.
- Any extracted collection discovery or Collections-view resolution helper should be tested as a
  small pure unit.
- The search-result collection interaction should be covered with component-level tests that assert
  loading, empty, validation, success, and partial-failure behavior.

### Prior art

- Existing frontend form tests around schema-backed entity and event creation provide the right
  pattern for validating generated inputs and payload shaping.
- Existing collection form tests provide prior art for collection template handling.
- Existing saved-view model and UI tests provide prior art for built-in saved-view lookup and route-
  adjacent behavior.

### Quality bar

- Prefer testing user-observable behavior over internal state.
- Prefer focused pure tests for schema-to-form helpers.
- Use component tests for row-panel interactions and notifications.
- Avoid tests that merely restate library behavior already guaranteed by Mantine, TanStack Form, or
  Zod.

## Out of Scope

- Inline collection creation from the search modal
- New backend collection listing or detail endpoints
- Displaying all existing collection memberships for a search result
- Bulk add-to-collection from search results
- Multi-select collection assignment in a single submit
- Nested object or array membership editors beyond the current flat primitive collection-template
  UI
- Collection removal UX from the search modal
- Relationship-driven collection detail browsing or recursive collection traversal

## Further Notes

- The implementation should stay small and build on the contracts that already exist instead of
  inventing speculative collection read abstractions.
- The feature should preserve the journal-like, calm interaction style of the existing search modal
  rather than turning the row into a dense admin form.
- Because the no-collections CTA points into the Collections saved view, this work assumes the
  built-in Collections view remains the canonical collection-creation destination for now.
- Future richer collection read APIs can later layer better membership-state display on top of this
  write-first UX without invalidating the interaction model introduced here.

---

## Tasks

**Overall Progress:** 0 of 5 tasks completed

**Current Task:** [Task 01](./01-collection-discovery-and-navigation-helpers.md) (todo)

### Task List

| #   | Task                                                                                                             | Type | Status | Blocked By       |
| --- | ---------------------------------------------------------------------------------------------------------------- | ---- | ------ | ---------------- |
| 01  | [Collection Discovery And Navigation Helpers](./01-collection-discovery-and-navigation-helpers.md)               | AFK  | todo   | None             |
| 02  | [Inline Collection Panel In Search Result Rows](./02-inline-collection-panel-in-search-result-rows.md)           | AFK  | todo   | Task 01          |
| 03  | [Membership Form Generation And Validation](./03-membership-form-generation-and-validation.md)                   | AFK  | todo   | Task 01          |
| 04  | [Save To Collection Orchestration And Notifications](./04-save-to-collection-orchestration-and-notifications.md) | AFK  | todo   | Tasks 02, 03     |
| 05  | [End To End Interaction And Form Tests](./05-end-to-end-interaction-and-form-tests.md)                           | AFK  | todo   | Tasks 02, 03, 04 |
