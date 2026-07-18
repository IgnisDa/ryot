# Content-Addressed Disk Modules

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** done

## What to build

Replace per-execution data-URL module imports with immutable local module files as specified under
"Runtime module materialization". Read the overview, Phase 4 plan, parent PRD, and this task first.

Measure a stable provider-heavy execution before changing the loader. Materialize compiled bytes by
content hash in the approved sandbox runtime area, publish atomically under concurrency, pass only the
path needed by the runner, import as a file module, and preserve source-mapped sanitized errors. Add
disk-liveness integration points for task 14 without implementing database GC in this task.

## Acceptance criteria

- [x] A before measurement is recorded for the selected provider-heavy path
- [x] Persisted compiled bytes materialize under a deterministic content-hash path
- [x] Bytes/hash are verified and temporary files publish atomically
- [x] Concurrent executions of one hash converge without partial or duplicate visible modules
- [x] The execution payload no longer transports compiled source once all consumers use the file path
- [x] Deno read grants remain limited to the approved immutable runtime area
- [x] Remote resolution, ambient config, npm, environment, subprocess, and write access remain denied
- [x] Returned errors preserve source locations without exposing local module paths or secrets
- [x] Post-change operational measurement disposition is recorded in the Phase 4 plan
- [x] Unit, integration, runner, and provider-heavy e2e coverage passes

## Implementation notes

Compiled modules use `modules/<compiled-hash>.mjs` inside the approved runtime directory. Runtime
materialization verifies exact bytes before publishing through a non-overwriting atomic link, rejects
corrupt destinations, makes published files read-only, and exposes the module directory for Task 14
liveness cleanup. Runner payloads now contain the module path instead of compiled source. Existing
Deno permission flags are unchanged, and source-mapped errors sanitize local paths.

The pre-change operational gate timed out at its unchanged 900,000ms deadline (`902.16s` test body,
`911.20s` total) without backend execution errors or deadlocks. Per owner direction, Task 10 was
completed without rerunning that operational gate; post-change measurement is deferred to separate
diagnosis. Backend tests passed 136 files and 949 tests. The hermetic provider search/import e2e suite
passed 11 tests in 18.48s.

## User stories addressed

- User story 20
- User story 21
- User story 22
- User story 23
