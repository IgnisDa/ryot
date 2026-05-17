# Migrate Media Automations and Operations

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** done

## What to build

Migrate media lifecycle automations, policies, generic operations, cron/boot/bootstrap scripts, and
trending behavior to universal workflow bodies. This includes the no-op/early-return and full-write
paths of `auto-complete-on-full-progress`, relationship and entity update automation, notifications,
integration policies, Radarr/Sonarr/Jellyfin pushes, media monitoring operations, metadata lookup,
and media trending.

Use transparent durable host calls for queries and writes, deterministic execution time where needed,
and owning backend workflows where the dispatcher specifies them. Preserve `Effect.all` logical
parallelism and deterministic result ordering. Update bindings, cron/operation/bootstrap manifest
references, focused tests, and media lifecycle E2E in lockstep. Do not create wrapper child workflows
solely to imitate the removed activity execution model.

## Acceptance criteria

- [x] Every media automation, policy, operation, cron, and bootstrap body uses universal workflow
      execution.
- [x] Auto-complete early return makes no unnecessary durable calls and remains inside the same
      universal runtime.
- [x] Full automation branches replay query/schema reads and create business writes exactly once at
      their owning boundaries.
- [x] Parallel durable reads preserve deterministic ordering and current business outcomes.
- [x] Notification/signal/external-push semantics follow the completed write-host safety audit.
- [x] Manifest cron execution-mode selectors are migrated where no remaining consumer needs them.
- [x] Existing media lifecycle, monitoring, association, notification, and operation assertions are
      preserved in plugin/backend tests and `tests/` E2E.
- [x] The no-host automation benchmark is rerun and material regressions are recorded for Task 15.

## Completion Notes

- Migrated media automations, policies, operations, cron, boot, bootstrap, and event dispatch to the
  universal sandbox workflow and removed obsolete cron execution-mode selectors.
- Preserved the direct sandbox execution result contract, including logs, timing, and failure-bearing
  results, so automation runs and plugin operations are finalized consistently.
- Updated cron reporting to distinguish failed workflow executions from successful executions and to
  log scheduled failures without stopping other due crons.

## Verification

The no-host benchmark was rerun on 2026-08-06 with the warm hermetic harness from the phase plan:

```bash
RUN_SANDBOX_BENCHMARKS=1 bun turbo --env-mode=loose --force --output-logs=full --filter=@ryot/tests test --only -- 'src/tests/kernel/sandbox/sandbox-runtime-benchmark.test.ts'
```

On the Apple M4 baseline host, the no-host automation measured 221/249 ms submission-to-terminal
p50/p95 and 10/26 ms sandbox execution p50/p95 across 15 samples. The current-runtime baseline was
221/266 ms, so this run shows no material no-host regression; the result is recorded for the Task 15
comparison.

The focused backend regression suite, full backend test suite, contract check, and affected media
automation and trending-cron E2E files passed after the reviewer fixes.

## User stories addressed

- User story 1
- User story 2
- User story 4
- User story 5
- User story 9
- User story 12
- User story 13
