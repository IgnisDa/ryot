# Close the Phase 1 Verification Gate

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** todo

## What to build

Close every Phase 1 done criterion without introducing new architecture. Repair regressions found by
the final gates, update current-state documentation to describe only the universal runtime, rerun the
Phase 0 performance harness against the fully migrated catalog, and record results plus any explicit
owner-approved waiver in the Phase 1 plan.

Run focused checks/tests for every changed package, each affected/new standard E2E file separately,
the discovered standard E2E suite, and the standalone media population operational gate according to
`tests/README.md`. Keep live-provider smoke opt-in and excluded unless explicitly requested. Confirm
the complete write-host audit, Youtubei/restart evidence, artifact lifetime, removal searches, byte
limits, diagnostics redaction, and no-held-sandbox guarantees before marking this task done.

## Acceptance criteria

- [ ] Every Phase 1 done criterion in the authoritative plan is evidenced and checked off or linked
      to a concrete passing result.
- [ ] SDK, compiler, plugin-kit, media plugin, fitness plugin, backend, and tests package checks pass.
- [ ] Their focused unit/integration test suites pass using repository-standard Turbo commands.
- [ ] Every affected/new standard E2E file passes in an isolated final run.
- [ ] The complete discovered standard E2E suite passes with no unclassified failure.
- [ ] The media population operational gate passes under its documented standalone command.
- [ ] Final no-host, provider, Youtubei, bounded import, and operational benchmarks are recorded
      against Task 01; guardrail misses have an optimization result or explicit owner waiver.
- [ ] Current documentation describes one universal sandbox execution model, replay diagnostics,
      durability/storage boundaries, artifact lifetime, byte limits, and at-least-once external HTTP.
- [ ] Searches prove the standard runtime, activity execution kind, obsolete manifest selectors, and
      direct scratch-output model are gone.
- [ ] No generated ignored artifact or unrelated file is included in the change set.

## User stories addressed

- User story 11
- User story 12
- User story 13
- User story 14
