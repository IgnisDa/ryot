# Built-in Media Lifecycle Actions

## Problem Statement

The rewrite already supports external media search and entity creation for some built-in media
schemas, but the flow stops after the entity is added. The product needs a coherent post-search
action model so users can express intent and activity around a media item immediately: add it to
backlog, log progress, mark it complete, and leave a rating or review.

Ryot V1 handled several of these concepts through default collections such as Watchlist, In
Progress, and Completed. That model mixed lifecycle state, durable subscriptions, inventory, and
provenance into one mechanism. The rewrite should not carry that ambiguity forward. Built-in media
actions need first-class semantics that match the entity-event architecture in the SOUL document.

At the same time, the current backend only supports generated event logging for custom entity
schemas. Built-in entity schemas do not yet support event creation through the shared events API,
so the frontend cannot implement the intended media action flow against stable backend contracts.

## Solution

Introduce built-in media lifecycle actions as seeded built-in event schemas attached to supported
media entity schemas. The canonical action slugs are:

- `backlog`
- `progress`
- `complete`
- `review`

These actions are written through the existing generic events contract rather than tracker-specific
endpoints. The backend is extended so built-in media schemas can participate in event creation with
explicit validation rules.

The first implementation only seeds and enables the media schemas that the rewrite currently
supports, but the contract is defined generically so additional built-in media schemas can join
later without changing the model.

The rewrite treats these actions as lifecycle semantics rather than collection membership:

- backlog expresses intent to consume later
- progress expresses partial consumption
- complete expresses explicit completion
- review expresses a required rating plus optional review text

Derived overview state is intentionally deferred. The current prototype sections that depend on
derived state remain frontend-only placeholders for now. This PRD covers the canonical write model
and the backend support needed for it.

## User Stories

1. As a user, I want to add a movie to my backlog immediately after search, so that Ryot records
   that I intend to watch it later.
2. As a user, I want to log partial progress on a movie, so that Ryot remembers that I have
   started but not finished it.
3. As a user, I want to explicitly mark a movie complete, so that Ryot records a clear finish
   moment instead of inferring it indirectly.
4. As a user, I want to leave a rating with an optional written review, so that I can capture my
   judgment in a structured way.
5. As a user, I want backlog, progress, completion, and review to work the same way across books,
   anime, manga, and future built-in media types, so that the media tracker feels consistent.
6. As a user, I want to repeat lifecycle actions over time, so that rewatches, rereads, and
   updated reviews are naturally represented.
7. As a user, I want to review something even if I did not mark it complete first, so that I can
   record partial opinions, abandonments, or retrospective ratings.
8. As a user, I want a progress action to capture percentage only, so that the UI can adapt to
   media with or without reliable unit totals.
9. As a user, I want completion to be a distinct action from progress, so that the product does
   not silently reinterpret my input.
10. As a user, I want adding something to backlog to remain part of my history even after I start
    consuming it, so that my timeline reflects the full lifecycle.
11. As a user, I want a backlog item to stop counting as currently in backlog once I make real
    progress or complete it, so that future overview surfaces can reflect current intent.
12. As a user, I want to log multiple progress updates for the same item, so that long-form media
    can accumulate a natural trail of intermediate activity.
13. As a user, I want to mark the same item complete multiple times, so that rewatches and
    rereads are preserved instead of overwritten.
14. As a user, I want to leave multiple reviews over time, so that my opinion can evolve across
    repeat consumptions.
15. As a frontend developer, I want to use the generic events API for built-in media actions, so
    that the backend contract stays uniform and future UI flows do not depend on one-off routes.
16. As a backend developer, I want built-in event schemas to be seeded in bootstrap manifests, so
    that built-in media behavior stays declarative and versioned with the platform.
17. As a backend developer, I want built-in media event validation to be explicit and narrow, so
    that invalid progress, completion, and review payloads fail predictably.
18. As a backend developer, I want the semantics of backlog, progress, complete, and review to be
    shared across media schemas, so that future built-in media types can adopt them easily.
19. As a backend developer, I want per-schema property payloads where needed, so that the shared
    semantic model does not force every media type into an identical shape.
20. As a backend developer, I want the current events module to stop excluding built-in entity
    schemas from event creation, so that built-in trackers can use the same event foundation as
    custom trackers.
21. As a backend developer, I want the backend to preserve event history instead of materializing
    tracker state into reserved collections, so that lifecycle decisions remain auditable.
22. As a backend developer, I want explicit completion events instead of `progress = 100`, so that
    automatic writes and ambiguous history are avoided.
23. As a future integration author, I want external systems such as Jellyfin to emit the same
    canonical lifecycle events a human would create, so that manual and automated tracking share
    one model.
24. As a future integration author, I want source attribution and idempotency strategy to be
    considered, so that webhook-driven writes can be made reliable later without changing the core
    lifecycle contract.
25. As a product developer, I want the backend write model settled before deriving overview
    sections from it, so that read-side queries are built on stable semantics.

## Implementation Decisions

### Feature scope

- Define the contract generically now.
- Seed and enable only the currently supported built-in media schemas in the first increment.
- Additional built-in media schemas should adopt the same semantic slugs later without changing
  the action model.
- The phase 1 built-in media schemas in scope are `book`, `anime`, and `manga`.

### Canonical built-in media actions

The only built-in media lifecycle actions in scope are:

- `backlog`
- `progress`
- `complete`
- `review`

These are semantic slugs shared across built-in media schemas.

### API contract shape

- Use the generic events API rather than dedicated media action endpoints.
- Built-in media actions are implemented as built-in event schemas and created through the same
  public event-writing surface used elsewhere.
- The current code that blocks built-in entity schemas from event creation may be rewritten as
  needed to support this model.
- Event schema listing should return both built-in and user-owned event schemas visible to the
  current user.
- Event schema creation remains a custom-schema feature; this PRD does not introduce API support
  for user-authored built-in event schemas.
- Built-in media entities may only create events using seeded built-in event schemas that belong to
  their entity schema.
- Lifecycle events should continue to work through the existing bulk `POST /events` contract as
  well as the single-event shape accepted by that endpoint.

### Built-in event schema registration

- Built-in media event schemas live in bootstrap manifests alongside existing built-in schema
  definitions.
- Bootstrap becomes the source of truth for seeded built-in media lifecycle semantics.
- The implementation may reshape the current bootstrap code if needed, but the outcome should stay
  declarative and centrally defined.
- The seeded built-in lifecycle event schema display names should be `Backlog`, `Progress`,
  `Complete`, and `Review`.
- The old book-specific `read` built-in event schema should be removed or replaced during the
  cleanup slice rather than carried forward as an alias.

### Action semantics

#### backlog

- Represents intent to consume an item later.
- Is recorded as an event, not collection membership.
- Repeated backlog events are allowed.
- Current backlog state should eventually stop counting once meaningful progress or explicit
  completion exists.

#### progress

- Represents partial consumption.
- Repeated progress events are allowed.
- Uses percentage only rather than domain units.
- The frontend may convert domain units into percentage before submission.
- Stores `progressPercent` as a number, not an integer, so fractional progress is preserved.
- The backend should normalize `progressPercent` to 2 decimal places on write using a stable
  half-up rounding rule.
- `progressPercent` must be greater than `0` and less than `100`.
- Progress must remain distinct from completion; it should not auto-create a completion event.

#### complete

- Represents explicit completion.
- Repeated completion events are allowed.
- Completion is not inferred from progress reaching a threshold.
- Future reads may derive current completed state from completion history, but that derivation is
  deferred.

#### review

- Represents personal judgment.
- Requires a rating.
- Allows an optional written review body.
- Can be created at any time, including before a completion event exists.
- Repeated review events are allowed.
- `rating` should be an integer in the range `1..5`.

### Shared semantics with per-schema payloads

- Semantic slugs are shared across built-in media schemas.
- Property payloads may vary by schema when needed.
- The initial recommended payloads are:
  - `backlog`: empty object
  - `progress`: `{ progressPercent: number }`
  - `complete`: empty object
  - `review`: `{ rating: integer, review?: string }`
- The first implementation should keep these payloads consistent across supported built-in media
  schemas unless a concrete schema-specific need appears.

### Relationship to V1 collections

- Do not recreate V1 default media collections as rewrite collections.
- `Watchlist`, `In Progress`, and `Completed` are treated as lifecycle concepts in the rewrite.
- Persistent concepts such as monitoring, ownership, reminders, and provenance remain separate
  concerns and are not part of this PRD's implementation scope.

### Derived state is deferred

- The backend write model is in scope.
- Derived read-side state for media overview sections is not in scope.
- Sections such as `Up Next`, `Continue`, and `Rate These` can remain static or placeholder-driven
  on the frontend until a later read-model effort formalizes derivation rules.
- This PRD intentionally avoids locking the query rules for current backlog, in-progress, or
  review-needed surfaces.

### Deep modules to build or modify

The implementation should prefer a few deep modules over many shallow tracker-specific checks.

- A built-in event schema bootstrap module that declares seeded media lifecycle schemas.
- A media lifecycle validation module that owns semantic rules for built-in actions.
- An event access module that resolves whether an entity schema and event schema combination is
  valid for the current user, including built-in media cases.
- A service-level write path that keeps route handlers thin and makes built-in lifecycle behavior
  easy to test in isolation.

### Integration note

- Future integrations should emit the same canonical lifecycle events as manual UI flows.
- Idempotency and source attribution matter, but they are deferred to later integration work.
- The core lifecycle contract in this PRD should not be shaped around a particular integration.

### Additional implementation defaults

- Validation and not-found responses should continue to use the backend's existing shared response
  patterns rather than introducing tracker-specific error envelopes.
- The implementation should preserve the shared event-writing path instead of adding a parallel
  media-only persistence mechanism.

## Testing Decisions

A good test verifies externally observable behavior through stable public interfaces. Tests should
assert accepted and rejected action writes, returned event data, and access rules. They should not
assert internal helper structure or persistence implementation details beyond the behavior exposed
by services and routes.

### Modules with tests

#### Built-in media lifecycle validation

- Test the validation rules for each semantic action.
- Cover accepted and rejected payloads.
- Keep this logic in a pure module with injected or static inputs so it is easy to test without a
  database.
- Cover `progressPercent` range handling and rounding to 2 decimal places.
- Cover `rating` range handling for review events.

#### Event access resolution for built-in media

- Test that built-in media entities can create events through the shared event path.
- Test mismatched event schema and entity schema combinations.
- Test not-found cases and invalid built-in/custom combinations.

#### Event service behavior for built-in actions

- Extend the existing event service tests to cover successful creation of built-in media events.
- Cover repeatability for backlog, progress, complete, and review.
- Cover the explicit-complete rule so progress does not silently become completion.

#### Bootstrap manifest coverage

- Add tests that prove the expected built-in media event schemas are registered from bootstrap and
  exposed consistently.

### Test style prior art

- Follow the repo's existing service-dependency injection style used in backend module tests.
- Favor pure helper tests for validation and access decisions.
- Use route or end-to-end tests only where module-level tests cannot adequately verify the public
  contract.

### Integration tests in `tests/src`

- Add thin end-to-end coverage in `tests/src/tests` for the seeded built-in media lifecycle
  contract.
- These tests should verify public API behavior after bootstrap rather than internal helper logic.
- Prior art includes the existing `events` and `entity-schemas` integration suites.
- Focus the integration layer on a small number of representative scenarios:
  - built-in event schema visibility for supported built-in media schemas
  - successful built-in `backlog` event creation
  - successful built-in `progress` event creation including rounding and range rejection
  - successful built-in `complete` event creation without implicit completion via progress
  - successful built-in `review` creation before completion and rejection of invalid ratings

### Modules that can wait for later read-side testing

- Media overview derivation logic is deferred, so no tests for `Up Next`, `Continue`, `Rate
  These`, or other read models are required in this phase.
- Integration-specific dedupe and source attribution behavior is also deferred.

## Out of Scope

- Derived overview queries and current-state read models.
- Replacing the current frontend placeholder sections with backend-driven data.
- Integration-specific idempotency, retry handling, or source attribution fields.
- Monitoring, ownership, reminders, or provenance models.
- Tracker-specific action endpoints separate from the generic events API.
- Non-media built-in lifecycle semantics.

## Further Notes

The main purpose of this PRD is to lock the rewrite's write model before the read model. Once the
canonical media lifecycle actions exist, later work can derive tracker overview sections and
integration adapters on top of stable semantics rather than on top of placeholder frontend logic
or V1 collection carryovers.

The initial event payload recommendation is intentionally minimal: payload-less `backlog` and
`complete` events, fractional `progressPercent` rounded to 2 decimals for `progress`, and an
integer `rating` plus optional `review` text for `review`.

---

## Tasks

**Overall Progress:** 6 of 6 tasks completed

**Current Task:** None - all tasks completed

### Task List

| # | Task | Type | Status | Blocked By |
|---|------|------|--------|------------|
| 01 | [Clean Up Built-in Event Schema Foundation](./01-clean-up-built-in-event-schema-foundation.md) | AFK | done | None |
| 02 | [Backlog Events for Built-in Media](./02-backlog-events-for-built-in-media.md) | AFK | done | Task 01 |
| 03 | [Progress Events for Built-in Media](./03-progress-events-for-built-in-media.md) | AFK | done | Task 01 |
| 04 | [Complete Events for Built-in Media](./04-complete-events-for-built-in-media.md) | AFK | done | Task 01 |
| 05 | [Review Events for Built-in Media](./05-review-events-for-built-in-media.md) | AFK | done | Task 01 |
| 06 | [Refresh Generated Media Lifecycle Contract](./06-refresh-generated-media-lifecycle-contract.md) | AFK | done | Tasks 02-05 |
