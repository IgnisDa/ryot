# Canonical Runtime Write Paths Cleanup

**Parent Plan:** [V2 Importing Infrastructure](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Clean up the V2 backend runtime write paths so entity, event, and relationship creation semantics are owned by a small set of canonical module APIs, without changing intentional product behavior. This is a boundary cleanup task before adding more import adapters.

The current import work exposed that provider population, library membership, event creation, collection membership, and startup preload have overlapping write side effects. Keep the generic entity/event/relationship model, but remove old duplicate code and make user-library side effects explicit at service boundaries.

This task is not about import idempotency. Running imports multiple times may create duplicate imported events/entities, and that is acceptable for this plan. Legacy bootstrap stays in place and remains a migration-only exception to runtime write-path rules.

## Scope

- Delete dead media import worker code superseded by the entity worker.
- Remove duplicate provider-population logic and old media queue/job artifacts if unused.
- Stop exporting low-level entity/collection repository write primitives from module barrels where runtime callers should use service APIs instead.
- Replace `linkToLibrary` as a low-level provider-population option with explicit library-membership orchestration at higher-level service/import boundaries.
- Keep provider population focused on global entity population and provider-related global relationships.
- Add or expose a canonical service API for creating the user-owned `in-library` relationship, for example `ensureEntityInLibrary`.
- Ensure event creation APIs own trigger dispatch so callers do not manually call trigger processing.
- Keep collection membership writes through the collection service.
- Keep OpenScale duplicate behavior as-is; no import idempotency work in this task.
- Leave workout-template JSON exercise references as-is.
- Leave future fitness importer design out of scope.
- Leave `modules/legacy-bootstrap` and its raw SQL writes in place.
- Clean up old E2E tests in `tests/`, including tests related to the old media module or old media import behavior, so the E2E suite matches the canonical write paths.

## Acceptance criteria

- [ ] `apps/app-backend/src/modules/media/worker.ts` and `apps/app-backend/src/modules/media/jobs.ts` are deleted if no runtime code uses them.
- [ ] Test fixtures and unit tests that only supported the dead media worker are deleted or moved to the canonical entity/provider-population tests.
- [ ] Runtime code outside an owning module cannot import repository write primitives for `entity`, `event`, or `relationship` creation through barrels.
- [ ] Provider population no longer accepts or acts on a `linkToLibrary` flag.
- [ ] Entity preload remains populate-only and does not create user-owned `in-library` relationships.
- [ ] User-facing entity import and media/source import flows explicitly link entities to the user's library only through the canonical library-membership service API when product semantics require it.
- [ ] Event creation exposed outside the events module goes through an API that creates events and enqueues event-schema triggers as one event-module-owned operation.
- [ ] Import processors do not call low-level event trigger dispatch directly.
- [ ] Collection membership creation remains owned by the collections service.
- [ ] `legacy-bootstrap` remains wired and documented as a migration-only exception.
- [ ] Old E2E tests under `tests/` that assert removed media module behavior or obsolete media import routes/jobs are removed or updated.
- [ ] Backend checks and tests pass.
- [ ] Relevant E2E checks pass or the task documents which legacy E2E coverage was intentionally removed.

## Non-goals

- Do not make imports idempotent.
- Do not prevent duplicate imported rows when users run the same import multiple times.
- Do not redesign workout-template JSON references.
- Do not design future Hevy/StrongApp fitness import orchestration in this task.
- Do not remove or rewrite legacy bootstrap.
- Do not add broad architecture tests unless needed to prevent this cleanup from regressing.

## User stories addressed

Reference by number from the parent PRD:

- User story 21
- User story 25
- User story 30
