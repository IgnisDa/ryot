# Make Sandbox Artifacts Replay-Safe

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** done

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

- [x] Input artifacts are immutable/content-addressed and pinned until terminal workflow cleanup.
- [x] Replays receive the same input grants without copying file contents into the JSON journal.
- [x] Chunk writes are durable host operations and are not repeated during replay.
- [x] Scripts and child workflows receive opaque handles, never host paths.
- [x] Handles remain valid across suspension/restart and do not depend on a one-hour correctness TTL.
- [x] Entry, depth, path, symlink, and total-byte constraints are enforced before handles publish.
- [x] Cancellation/failure cleanup preserves files still referenced by active children and removes
      terminal workflow artifacts.
- [x] Focused filesystem/backend tests and the updated harvest-handle E2E pass.
- [x] No second replay-unsafe output path is introduced for simple scripts.

## Implementation notes

- `SandboxArtifactStore` owns one stable local workflow-artifact root. Input bytes are copied to
  SHA-256 names, verified inside the canonical temporary-storage root, and made read-only before a
  grant is returned. Workflow payloads retain only grants and opaque identities, not file contents.
- Generated chunks are validated in scratch staging before deterministic owner-scoped handles
  publish. The existing activity tracer remains the durable materialization boundary until Task 06
  migrates the import catalog; staging is removed immediately and is not a second published path.
- Orchestrators, child dispatches, sandbox workflows, and kernel consumers use distinct durable
  references. Dispatch references bridge child startup, consumers retain in their first durable
  activity, suspension preserves references, and terminal success/failure releases them.
- Kernel workflow payloads keep `chunkHandles`; host paths are resolved only inside the kernel-owned
  chunk-read activity. Handle storage is filesystem-backed and restart-stable rather than Redis-TTL
  dependent.
- Named import inputs expose their artifact key as the source-payload marker instead of leaking the
  uploaded host path. The sandbox receives only read grants to immutable materialized copies.

## Verification

- `bun turbo --filter=@ryot/contract check`
- `bun turbo --filter=@ryot/app-backend check`
- `bun turbo --filter=@ryot/app-backend test`
- `bun turbo --filter=@ryot/tests check`
- `bun turbo --force --filter=@ryot/tests test --only -- 'src/tests/kernel/imports/imports.test.ts'`

## User stories addressed

- User story 3
- User story 7
- User story 13
