# Built-in Media Overview Read Model

## Problem Statement

The built-in media tracker overview in the frontend currently renders static placeholder data for
`Continue`, `Up Next`, `Rate These`, `Activity`, and `Library`. The visual shape is useful for
product exploration, but the first three sections are not yet powered by the actual lifecycle
events that the backend now supports for built-in media.

This creates a gap between the canonical media write model and the overview experience. Users can
log `backlog`, `progress`, `complete`, and `review` events for books, anime, and manga, but the
overview does not yet answer the obvious questions: what should I continue, what is queued next,
and what have I finished but not rated? If the frontend continues to derive these sections on its
own, it will need to rebuild lifecycle semantics, latest-event logic, ordering rules, reread and
rewatch behavior, and UI labeling logic that already belongs closer to the backend.

The product needs a backend-powered read model for only the first three built-in media overview
sections so the frontend can stay thin, the lifecycle rules stay consistent, and future overview
work can build on a stable contract.

## Solution

Introduce a backend read model for built-in media overview sections that uses the existing
view-runtime foundation internally but exposes a purpose-built response from the standalone media
module. The initial scope covers only `Continue`, `Up Next`, and `Rate These` for the seeded
built-in media schemas `book`, `anime`, and `manga`.

The read model derives current-state membership from latest-event semantics over the canonical
media lifecycle events:

- `Continue` and `Up Next` are mutually exclusive and are determined by whichever of `backlog`,
  `progress`, or `complete` is the latest lifecycle event for an entity.
- `Continue` includes entities whose latest lifecycle event is `progress`, even if they never had a
  prior `backlog` event.
- `Up Next` includes entities whose latest lifecycle event is `backlog`.
- If an entity's latest lifecycle event is `complete`, it is excluded from `Continue` and `Up Next`.
- `Rate These` is independent from current-state membership and includes entities whose latest
  `complete` event is newer than their latest `review` event, allowing overlap with `Continue` or
  `Up Next` when the event history supports it.

The backend response should include both structured raw values and UI-ready labels so the frontend
does minimal transformation. Time values remain raw timestamps rather than pre-formatted relative
strings. Display content is standardized across the first three sections: shared subtitle uses
`publishYear`, `Continue` CTAs are schema-specific, `Up Next` CTA is always `Start`, and unknown
totals still keep the item visible by returning `currentUnits: null` with a usable progress label.

## User Stories

1. As a media user, I want `Continue` to show items I most recently made progress on, so that I can resume what is actively in motion.
2. As a media user, I want `Up Next` to show items I most recently backlogged but have not started since, so that my queued intent feels current.
3. As a media user, I want `Continue` and `Up Next` to be mutually exclusive, so that the overview reflects one current lifecycle state per item.
4. As a media user, I want an item with a latest `progress` event to appear in `Continue` even if I never explicitly backlogged it first, so that direct starts still feel natural.
5. As a media user, I want an item whose latest lifecycle event is `complete` to disappear from `Continue` and `Up Next`, so that finished items no longer look active or queued.
6. As a media user, I want `Rate These` to show items I completed more recently than I reviewed, so that I can quickly rate unfinished reflections.
7. As a media user, I want `Rate These` to still include an item after rereading or rewatching it, so that each newer completion can prompt a fresh rating.
8. As a media user, I want `Rate These` to disappear once my latest review catches up to or exceeds my latest completion, so that the section only shows true follow-up work.
9. As a media user, I want rereads and rewatches to use latest-event semantics instead of one-time state flags, so that repeat consumption behaves correctly.
10. As a media user, I want `Continue` ordered by latest progress descending, so that the most recently active item appears first.
11. As a media user, I want `Up Next` ordered by latest backlog descending, so that the freshest queued item appears first.
12. As a media user, I want `Rate These` ordered by completion recency, so that the most recently finished item appears first.
13. As a media user, I want completion ordering to use explicit `completedOn` when present and fall back to event creation time otherwise, so that custom completion timestamps still sort correctly.
14. As a media user, I want books, anime, and manga to share one overview model, so that the media tracker feels coherent across supported built-in schemas.
15. As a media user, I want the shared subtitle to use `publishYear`, so that cards stay visually consistent across supported media types.
16. As a media user, I want CTA labels in `Continue` to reflect the media type I am resuming, so that the action feels native to books, anime, and manga.
17. As a media user, I want `Up Next` cards to always use `Start`, so that queued items have one simple invitation.
18. As a media user, I want progress cards to remain useful even when the total unit count is unknown, so that open-ended or partially known metadata does not hide my item.
19. As a media user, I want the frontend to load ready-to-render section data, so that the overview feels fast and consistent.
20. As a frontend developer, I want the backend to return both raw fields and UI labels, so that I do not need to duplicate domain logic in the client.
21. As a frontend developer, I want timestamps returned as raw values, so that the client can keep relative-time formatting local and reusable.
22. As a frontend developer, I want no saved-view builder work to be required for this feature, so that the first increment stays focused on shipping the overview.
23. As a backend developer, I want the overview read model to use view-runtime internally, so that latest-event joins, expression evaluation, and schema visibility rules are reused instead of reimplemented ad hoc.
24. As a backend developer, I want the overview endpoint to expose a purpose-built contract instead of raw runtime query definitions, so that frontend callers do not need to construct complex AST payloads.
25. As a backend developer, I want current-state classification to come from lifecycle history rather than materialized columns, so that the read side stays faithful to the canonical event model.
26. As a backend developer, I want the section rules to be explicit and testable as pure classification logic, so that future overview additions can build on a stable core.
27. As a backend developer, I want raw structured values included alongside labels, so that future clients can reuse the read model without scraping rendered strings.
28. As a backend developer, I want schema-specific presentation defaults to live in backend-owned mapping code, so that frontend renderers stay generic.
29. As a product developer, I want this PRD scoped only to `Continue`, `Up Next`, and `Rate These`, so that activity and broader analytics do not delay the first real overview slice.
30. As a product developer, I want the first release limited to `book`, `anime`, and `manga`, so that the initial implementation follows the currently seeded built-in media schemas.

## Implementation Decisions

### Scope and surface area

- The first backend-powered overview slice covers only `Continue`, `Up Next`, and `Rate These`.
- `Activity`, `Library`, and any other overview sections remain outside this PRD.
- The read model applies only to built-in media schemas currently in scope: `book`, `anime`, and
  `manga`.
- No frontend saved-view builder, saved-view authoring, or generic query-builder UI work is part of
  this feature.

### Read-model architecture

- Introduce a dedicated built-in media overview read-model module rather than teaching the frontend
  to assemble raw view-runtime requests.
- The read-model module should call view-runtime internally for data retrieval and latest-event
  resolution, but it should own section semantics, response shaping, and presentation defaults.
- Keep route handlers thin and move section-building logic into testable service/helpers.
- Prefer a small number of deep modules:
  - an overview orchestrator that loads all three sections
  - a lifecycle classification module that determines section membership from latest events
  - a response builder that maps raw values into section-specific cards and labels

### Current-state semantics

- Current-state classification only considers the latest event among lifecycle slugs `backlog`,
  `progress`, and `complete`.
- `Continue` membership means the latest lifecycle event is `progress`.
- `Up Next` membership means the latest lifecycle event is `backlog`.
- `Continue` and `Up Next` are mutually exclusive by definition.
- `Continue` does not require any earlier `backlog` event.
- If the latest lifecycle event is `complete`, the entity is in neither `Continue` nor `Up Next`.
- These rules use latest-event semantics, so rereads and rewatches naturally move an entity between
  sections based on the newest relevant event.

### `Rate These` semantics

- `Rate These` membership is evaluated independently from current-state membership.
- An entity belongs in `Rate These` when its latest `complete` event is newer than its latest
  `review` event.
- If an entity has no review event and has at least one completion event, it belongs in `Rate These`.
- If the latest review is the same age or newer than the latest completion, the entity is excluded.
- `Rate These` can overlap with `Continue` or `Up Next` if the event timeline supports it, even
  though a latest lifecycle `complete` excludes the entity from current-state sections.
- If the latest lifecycle event is `complete`, the item should only be eligible for `Rate These`
  among the three sections in scope.

### Ordering rules

- `Continue` sorts by latest progress event timestamp descending.
- `Up Next` sorts by latest backlog event timestamp descending.
- `Rate These` sorts by `coalesce(complete.completedOn, complete.@createdAt)` descending.
- Ties should use a stable deterministic fallback such as entity id ascending so repeated fetches do
  not reorder identical timestamps.

### Backend contract shape

- Expose a purpose-built overview response from a standalone `/media/overview` endpoint instead of
  asking the frontend to interpret generic runtime fields.
- The top-level response should return the three sections separately, with each section carrying its
  own ordered items and item count.
- Each item should contain both raw structured fields and UI-ready labels.
- Raw time values should be timestamps, not relative strings.
- UI-ready labels should include at least the section CTA label and any progress/completion labels
  needed for direct rendering.

### Shared item payload defaults

- Every overview card should include stable identity and rendering primitives: entity id, entity
  schema slug, title, image, subtitle, and the timestamps relevant to its section.
- The shared subtitle for all supported schemas is `publishYear`.
- The backend should return the subtitle as both a raw numeric value when available and a display
  label suitable for direct rendering.
- The backend should return image values in the same raw structured form already used elsewhere so
  the frontend can reuse existing image helpers.

### Section-specific payload decisions

#### Continue

- Include the latest progress timestamp as a raw value.
- Include raw progress fields needed by the UI, including `currentUnits`, `totalUnits`, and any
  normalized progress information the backend can derive safely.
- Include a UI-ready progress label for display.
- If total units are unknown, keep the item in the section and return `currentUnits: null` plus a
  usable display label derived from the best available progress data.
- CTA labels are schema-specific:
  - `book`: `Log Progress`
  - `anime`: `Next Episode`
  - `manga`: `Log Progress`

#### Up Next

- Include the latest backlog timestamp as a raw value.
- Include the standard subtitle and image fields used by the card layout.
- CTA label is always `Start`.

#### Rate These

- Include the latest completion timestamp used for sorting as a raw value.
- Include the latest review timestamp as a raw value when present so clients can reason about why an
  item is present if needed.
- Include any existing rating value only when it is useful for display, but membership must still be
  driven by latest complete versus latest review recency.

### Use of view-runtime

- The overview read model should reuse view-runtime's schema visibility, latest-event joins,
  expression language, and raw field resolution rather than introducing parallel query semantics.
- The overview layer may issue one or more internal runtime queries per section if that keeps the
  implementation clear and stable.
- If a shared runtime helper can reduce duplication across the three sections without leaking UI
  concerns into view-runtime, it should be introduced.
- The overview feature should not require changes to saved-view authoring flows.

### Validation and access

- The overview endpoint should operate only on supported built-in media schemas and should live
  under the standalone media module at `/media/overview` rather than a tracker-scoped route.
- Unsupported schemas should be excluded by backend-owned configuration, not by frontend filtering.
- Missing built-in event schemas or malformed seeded data should fail predictably rather than
  silently returning incorrect sections.

### Frontend expectations

- The frontend overview component should stop owning lifecycle derivation logic.
- Frontend work should be limited to fetching the backend read model, rendering the returned
  sections, and formatting timestamps locally.
- The frontend should not need to construct view-runtime ASTs or replicate latest-event logic.

## Testing Decisions

A good test verifies externally observable overview behavior from stable inputs: entities, seeded
event schemas, event history, and the returned section payloads. Tests should prove section
membership, ordering, overlap behavior, and response shaping. They should not assert the internal
number of runtime queries or the exact helper decomposition used to produce the result.

### Modules to test

#### Lifecycle classification module

- Test pure classification of `Continue`, `Up Next`, and `Rate These` from prepared latest-event
  inputs.
- Cover mutually exclusive `Continue` versus `Up Next` behavior.
- Cover direct `progress` without prior `backlog`.
- Cover latest `complete` excluding current-state sections.
- Cover reread and rewatch timelines where later events move an entity back into a different state.
- Cover `Rate These` overlap and non-overlap cases based on latest `complete` versus latest `review`.

#### Overview response builder

- Test schema-specific CTA labels for `Continue`.
- Test shared `Start` CTA for `Up Next`.
- Test shared subtitle selection from `publishYear`.
- Test unknown totals preserving the item with `currentUnits: null` and a usable display label.
- Test raw timestamp fields remaining unformatted.

#### Overview service/orchestrator

- Test the full section assembly behavior for the standalone media overview endpoint.
- Verify the service returns the three sections in one response.
- Verify supported schema filtering is enforced.
- Verify ordering matches the agreed timestamps for all three sections.

#### End-to-end coverage

- Add integration coverage in the main `tests` package for the public overview contract.
- Seed representative books, anime, and manga entities with lifecycle histories and assert returned
  sections.
- Prior art should follow the current view-runtime end-to-end style plus the existing built-in media
  lifecycle event tests.

### Representative scenarios

- An item with only `progress` appears in `Continue`.
- An item with only `backlog` appears in `Up Next`.
- An item with `backlog` then `progress` moves from `Up Next` to `Continue`.
- An item with `progress` then `complete` leaves `Continue` and becomes eligible only for
  `Rate These`.
- An item with `complete` and no `review` appears in `Rate These`.
- An item with `complete`, then `review`, then later `complete` reappears in `Rate These`.
- An item with unknown totals still appears in `Continue` with `currentUnits: null`.
- Mixed book, anime, and manga fixtures return correct CTA labels and shared subtitle behavior.

## Out of Scope

- `Activity`, `Library`, and any other media overview sections not named in this PRD.
- Generic saved-view builder UX, saved-view presets, or frontend query construction tools.
- Non-media built-in trackers and non-built-in entity schemas.
- Additional built-in media schemas beyond `book`, `anime`, and `manga`.
- New write-model semantics for lifecycle events; this PRD builds on the already defined event model.
- Relative-time formatting and other client-side presentation polish beyond consuming the new
  response.
- Broader analytics, streaks, aggregates, or activity timelines.

## Further Notes

This PRD intentionally chooses a backend-owned read model instead of a frontend-assembled
view-runtime request because the first three sections are not just alternate layouts of one query.
They encode product semantics about current state, repeat consumption, rating debt, and UI defaults.
Keeping those rules in the backend avoids a second lifecycle engine from emerging in the client.

The existing view-runtime foundation is still the right underlying primitive. It already supports
schema-aware references, latest-event joins, computed expressions, and response field resolution.
The overview read model should treat view-runtime as an internal execution engine and then layer
section-specific semantics on top.

The first slice should prefer clarity over premature generalization. If later work adds more
overview sections, the classification and response-building modules from this feature should become
the foundation for a broader media overview service.

---

## Tasks

**Overall Progress:** 2 of 3 tasks completed

**Current Task:** [Task 03](./03-overview-hardening-and-mixed-media-coverage.md) (todo)

### Task List

| #   | Task                                                                                               | Type | Status | Blocked By |
| --- | -------------------------------------------------------------------------------------------------- | ---- | ------ | ---------- |
| 01  | [Media Overview Read Model And Sections](./01-media-overview-read-model-and-sections.md)           | AFK  | done   | None       |
| 02  | [Frontend Overview Integration](./02-frontend-overview-integration.md)                             | AFK  | done   | Task 01    |
| 03  | [Overview Hardening And Mixed-Media Coverage](./03-overview-hardening-and-mixed-media-coverage.md) | AFK  | todo   | Task 02    |
