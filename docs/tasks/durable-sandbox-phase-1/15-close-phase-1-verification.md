# Close the Phase 1 Verification Gate

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** done

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

- [x] Every Phase 1 done criterion in the authoritative plan is evidenced and checked off or linked
      to a concrete passing result, with the owner-waived gates documented below.
- [x] SDK, compiler, plugin-kit, media plugin, fitness plugin, backend, and tests package checks pass.
- [x] Their focused unit/integration test suites pass using repository-standard Turbo commands.
- [x] Every affected/new standard E2E file passes in an isolated final run.
- [x] The complete discovered standard E2E suite has an owner-approved execution waiver; affected
      runtime files passed in isolation.
- [x] The media population operational gate has an owner-approved execution waiver.
- [x] Final no-host, provider, Youtubei, bounded import, and operational benchmarks are recorded
      against Task 01; guardrail misses have an explicit owner-approved waiver.
- [x] Current documentation describes one universal sandbox execution model, replay diagnostics,
      durability/storage boundaries, artifact lifetime, byte limits, and at-least-once external HTTP.
- [x] Searches prove the standard runtime, activity execution kind, obsolete manifest selectors, and
      direct scratch-output model are gone.
- [x] No generated ignored artifact or unrelated file is included in the change set.

## Progress Notes

- Required package checks passed for `@ryot/sandbox-sdk`, `@ryot/sandbox-compiler`, `@ryot/plugin-kit`,
  `@ryot/media-plugin`, `@ryot/fitness-plugin`, `@ryot/app-backend`, and `@ryot/tests`.
- Required focused package tests passed for `@ryot/sandbox-sdk`, `@ryot/sandbox-compiler`,
  `@ryot/plugin-kit`, `@ryot/media-plugin`, `@ryot/fitness-plugin`, and `@ryot/app-backend`.
- The affected runtime E2E files passed in one isolated run: `kernel/sandbox/enqueue.test.ts`,
  `kernel/sandbox/durable-tracer.test.ts`, `kernel/sandbox/youtubei-tracer.test.ts`,
  `kernel/system/system-query-engine.test.ts`, `kernel/plugins/integration-ownership.test.ts`, and
  `kernel/integrations/plugin-provider-redaction.test.ts`.
- The final warm hermetic benchmark passed and is recorded in the Phase 1 plan. No-host and
  interactive-provider p95 guardrails were exceeded; the owner approved a documented waiver on
  2026-08-06 without restoring a standard execution path or adding runtime architecture.

### Final Benchmark Measurements (2026-08-06)

| Workload                          | Submission p50 / p95 | Orchestration p50 / p95 | Sandbox execution p50 / p95 |            Throughput | Executions / replays / modules | Redis projections / journal high-water |
| --------------------------------- | -------------------: | ----------------------: | --------------------------: | --------------------: | -----------------------------: | -------------------------------------: |
| No-host automation early return   |         476 / 648 ms |            476 / 648 ms |                  31 / 90 ms |                   n/a |                1.4 / 1.4 / 1.4 |                                  0 / 0 |
| Full automation                   |     1,099 / 1,466 ms |        1,099 / 1,466 ms |                  26 / 49 ms |                   n/a |             3.53 / 3.53 / 3.53 |                                  1 / 2 |
| Controlled HTTP provider          |       835 / 1,292 ms |          785 / 1,242 ms |                  23 / 41 ms |                   n/a |                      3 / 3 / 3 |                                  1 / 2 |
| Youtubei controlled HTTP provider |       950 / 1,637 ms |          900 / 1,587 ms |                 58 / 100 ms |                   n/a |                      3 / 3 / 3 |                                  1 / 2 |
| Bounded 10-item population chunk  |    9,424 / 11,091 ms |       9,424 / 11,091 ms |                         n/a | 1.061 / 1.203 items/s |                   21 / 21 / 21 |                                 1 / 10 |

The harness used 15 samples per direct workload, five measured 10-item population chunks, three
discarded warm-ups for direct workloads, and one population warm-up. The controlled HTTP delay was
25 ms per request. The population p50 throughput was 69.6% of the Task 01 baseline and remained
above the 50% guardrail; the no-host and interactive-provider latency misses are covered by the
owner-approved waiver recorded in the Phase 1 plan.

- Current runtime guidance was updated in `apps/app-backend/src/lib/infrastructure/sandbox-runtime/README.md`
  to describe the universal workflow, durable dispatcher/journal, storage ownership, artifact lifetime,
  byte limits, replay diagnostics, and at-least-once external HTTP.
- Per owner instruction, the complete discovered standard E2E suite and the standalone media population
  operational gate were not run. Live-provider smoke remained excluded. These are explicit verification
  waivers, not passing-test claims.

## User stories addressed

- User story 11
- User story 12
- User story 13
- User story 14
