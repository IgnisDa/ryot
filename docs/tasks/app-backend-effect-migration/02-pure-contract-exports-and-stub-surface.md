# Pure Contract Exports And Stub Surface

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** done

## What to build

Define the pure app-owned Effect `HttpApi` contract and export it from a side-effect-free public subpath. Add every intended app-owned route group with Effect Schema request and response schemas, auth/admin middleware markers, direct success values, tagged expected errors, and a temporary typed `NotImplemented` error for handlers that are not migrated yet.

Importing the contract must never start the server or initialize runtime services. Route handlers should validate request shape and security middleware before returning `NotImplemented`.

## Acceptance criteria

- [ ] `AppContract` is importable from a pure public backend subpath
- [ ] Contract import does not initialize config, database, Redis, auth, migrations, or server startup
- [ ] All current app-owned route paths are represented except the intentionally skipped metrics endpoint
- [ ] Stubbed app-owned handlers return a typed `501 NotImplemented` after successful route-level validation
- [ ] Success schemas use direct values and not legacy `{ data }` envelopes
- [ ] Error schemas use tagged errors with explicit HTTP status mappings

## User stories addressed

Reference by number from the parent PRD:

- User story 4
- User story 6
- User story 7
- User story 8
- User story 20
- User story 57
- User story 58
- User story 59
