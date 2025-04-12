# Clean Up Built-in Event Schema Foundation

**Parent Plan:** [Built-in Media Lifecycle Actions](./README.md)

**Type:** AFK

**Status:** done

## What to build

Clean up the old built-in media event assumptions and establish a stable foundation for the new
media lifecycle model. This slice should introduce explicit built-in status on event schemas,
replace the obsolete seeded media event semantics, and remove custom-only assumptions from the
built-in event schema read and access path.

This task should leave the backend in a state where later slices can add `backlog`, `progress`,
`complete`, and `review` without fighting old bootstrap behavior, misleading route semantics, or
custom-only repository logic.

Phase 1 support in this cleanup is limited to the currently supported built-in media schemas:
`book`, `anime`, and `manga`.

See the **Built-in event schema registration**, **Relationship to V1 collections**, and **Deep
modules to build or modify** sections of the parent PRD.

## Acceptance criteria

- [ ] `event_schema` has explicit built-in state instead of relying only on implicit conventions.
- [ ] Built-in media event schema seeding is defined through a clean bootstrap path suitable for
      the new lifecycle model.
- [ ] The obsolete built-in book-only lifecycle/event semantics are removed or replaced so they do
      not conflict with the new action model.
- [ ] The old book-specific `read` built-in event schema is removed or replaced rather than kept as
      a compatibility alias.
- [ ] Listing event schemas for a built-in media schema returns seeded built-in event schemas to
      authenticated users.
- [ ] Event schema listing behavior supports both built-in and user-owned visible event schemas,
      while event schema creation remains custom-only.
- [ ] Backend wording and behavior no longer describe event schemas as custom-only where built-in
      media support now exists.
- [ ] Tests cover the new built-in event schema visibility and bootstrap behavior.
- [ ] `tests/src` includes an integration-style assertion that supported built-in media schemas
      expose seeded built-in event schemas to an authenticated user.
- [ ] `bun run typecheck`, `bun test`, and `bun run lint` pass in `apps/app-backend`.

## Blocked by

None - can start immediately.

## User stories addressed

- User story 15
- User story 16
- User story 17
- User story 18
- User story 19
- User story 20
- User story 21
