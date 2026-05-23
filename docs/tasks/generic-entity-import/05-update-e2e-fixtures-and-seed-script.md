# Update E2E Fixtures And Seed Script

**Parent Plan:** [Generic Entity Import](./README.md)

**Type:** AFK

**Status:** done

## What to build

Update E2E support code and the standalone seed script so they continue to exercise the import/search flow correctly after the generic import refactor. Preserve existing job lifecycle assertions while adding or keeping relationship-aware checks introduced by earlier slices.

The E2E fixture helpers for entity search, entity import, sandbox polling, and generic polling should only change if the public request or response shape they consume changes. The existing endpoint should remain stable, so most work should be focused on assertions and helper support for verifying related entity and relationship rows. The seed script has its own import/search polling logic and must be updated separately if it assumes old script output or import result behavior.

This slice should not introduce new product behavior; it should keep integration tests and seed/demo data aligned with the new generic import behavior.

## Acceptance criteria

- [x] Entity import E2E helpers still support enqueueing and polling imports through the existing public endpoint.
- [x] Existing entity import/search lifecycle E2E assertions still cover authentication, missing jobs, cross-user isolation, enqueue success, and terminal polling.
- [x] E2E support code can verify related entity placeholder rows and relationship rows where tests need direct database assertions.
- [x] Import tests using OpenLibrary still pass without requiring provider API keys.
- [x] The standalone seed script no longer assumes linked related entities live in primary `people`, `companies`, or `groups` properties.
- [x] The standalone seed script continues importing and searching seeded media items successfully.
- [x] No E2E helper retains obsolete assumptions about person/company/group populate jobs.

## User stories addressed

Reference by number from the parent PRD:

- User story 28
- User story 30
- User story 31
