# Make Sandbox Artifacts Replay-Safe

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** todo

## What to build

Implement the replay-safe filesystem model from Phase 1 section 6 as a vertical import tracer.
Materialize content-addressed immutable inputs, pin them for the workflow lifetime, and grant each
replay read-only access. Replace replay-unsafe scratch/chunk output with a durable operation that
materializes each exact chunk once and returns opaque handles valid until terminal workflow cleanup.

Preserve path containment, named artifacts, quotas, and kernel-only handle resolution. Cancellation,
failure, parent restart, and child execution must not delete files while an active workflow still
references them. Update the existing harvest-handle import E2E fixture to prove the new behavior;
leave full media import catalog migration to Task 06.

## Acceptance criteria

- [ ] Input artifacts are immutable/content-addressed and pinned until terminal workflow cleanup.
- [ ] Replays receive the same input grants without copying file contents into the JSON journal.
- [ ] Chunk writes are durable host operations and are not repeated during replay.
- [ ] Scripts and child workflows receive opaque handles, never host paths.
- [ ] Handles remain valid across suspension/restart and do not depend on a one-hour correctness TTL.
- [ ] Entry, depth, path, symlink, and total-byte constraints are enforced before handles publish.
- [ ] Cancellation/failure cleanup preserves files still referenced by active children and removes
      terminal workflow artifacts.
- [ ] Focused filesystem/backend tests and the updated harvest-handle E2E pass.
- [ ] No second replay-unsafe output path is introduced for simple scripts.

## User stories addressed

- User story 3
- User story 7
- User story 13
