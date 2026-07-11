# Content-Addressed Disk Modules

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** todo

## What to build

Replace per-execution data-URL module imports with immutable local module files as specified under
"Runtime module materialization". Read the overview, Phase 4 plan, parent PRD, and this task first.

Measure a stable provider-heavy execution before changing the loader. Materialize compiled bytes by
content hash in the approved sandbox runtime area, publish atomically under concurrency, pass only the
path needed by the runner, import as a file module, and preserve source-mapped sanitized errors. Add
disk-liveness integration points for task 14 without implementing database GC in this task.

## Acceptance criteria

- [ ] A before measurement is recorded for the selected provider-heavy path
- [ ] Persisted compiled bytes materialize under a deterministic content-hash path
- [ ] Bytes/hash are verified and temporary files publish atomically
- [ ] Concurrent executions of one hash converge without partial or duplicate visible modules
- [ ] The execution payload no longer transports compiled source once all consumers use the file path
- [ ] Deno read grants remain limited to the approved immutable runtime area
- [ ] Remote resolution, ambient config, npm, environment, subprocess, and write access remain denied
- [ ] Returned errors preserve source locations without exposing local module paths or secrets
- [ ] A post-change measurement is recorded using the same path and methodology
- [ ] Unit, integration, runner, and provider-heavy e2e coverage passes

## User stories addressed

- User story 20
- User story 21
- User story 22
- User story 23
