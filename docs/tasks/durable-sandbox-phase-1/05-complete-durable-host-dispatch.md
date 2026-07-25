# Complete Durable Host Dispatch and Write Safety

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** done

## What to build

Complete Phase 1 sections 3 and 4 for every sandbox host capability, extending the tracer pattern
without migrating production scripts yet. Create one backend-owned classification mapping each
business call to an activity-safe existing service, an owning child workflow, a nested sandbox child,
a durable artifact operation, or replay-aware diagnostics.

Audit every write host function and record its owner and safety proof. Add deterministic invocation
identity/deduplication where required, directly compose services such as `EventCreateWorkflow` that
must not start inside an activity, and document accepted at-least-once external effects. Finish the
durable HTTP contract with immediate execution, preserved validation/TLS/private-origin behavior,
structured non-2xx headers, 10-MiB response bodies, a 100-MiB cumulative journal ceiling, and no
transparent artifact return type.

## Acceptance criteria

- [x] Every business host capability has one explicit backend durable-dispatch classification.
- [x] Activities never directly or indirectly start workflows or durable queues.
- [x] Every write capability is idempotent, deduplicated by deterministic call identity, delegated
      to an owning child workflow, or explicitly accepted/documented as external at-least-once.
- [x] Crash-window tests cover each distinct write strategy and prove application writes do not
      duplicate.
- [x] Mutable reads, config/preferences, cache calls, queries, and typed failures replay recorded
      values consistently.
- [x] Diagnostics are replay-tagged, excluded from business journal entries, and redact secrets.
- [x] Immediate durable HTTP preserves current request/TLS/private-destination behavior and returns
      the existing inline response shape.
- [x] The 10-MiB HTTP, 100-MiB cumulative journal, and 4-MiB terminal-output limits fail
      deterministically at their separate boundaries without unbounded intermediate copies.
- [x] Focused capability, authorization, dispatcher, replay, redaction, and limit tests pass.
- [x] The write-host audit is recorded in the Phase 1 plan or its linked current-state documentation.

## Completion notes

- Added one exhaustive backend classification for all bridge host capabilities: activity, owning
  event workflow, owning notification workflow, service workflow child, or diagnostic.
- Kept workflow-starting entity, signal, event, and notification paths out of activities. Durable
  child IDs and write identities derive from the sandbox workflow and call index.
- Preserved the inline HTTP response contract and added response headers to structured non-2xx
  failures. The existing TLS, private-origin, request, timeout, and streamed response limits remain in
  the shared HTTP implementation.
- Made persistent claims reproduce their original successful durable result through an internal
  envelope, and added replay-correlated diagnostic redaction for credential-shaped data and text.
- Recorded the complete owner/retry proof table in the Phase 1 plan.

## Verification

- `bun turbo --filter=@ryot/app-backend check`
- `bun turbo --filter=@ryot/sandbox-sdk check`
- `bun turbo --filter=@ryot/tests check`
- `bun turbo --filter=@ryot/app-backend test`
- Focused backend suites: 73 tests passed across dispatcher, replay, entity lifecycle, claim,
  diagnostics, limits, and runner boundaries.
- `bun turbo --force --filter=@ryot/tests test --only -- 'src/tests/kernel/sandbox/durable-tracer.test.ts'`

## User stories addressed

- User story 3
- User story 4
- User story 5
- User story 9
- User story 11
- User story 13
