# Superseded Script and Module GC

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** done

## What to build

Implement script-row and disk-module garbage collection using the liveness model established by task 13. Read the overview, Phase 4 plan, parent PRD, this task, and task 13's completed decision record
before implementation.

Compute live plugin hashes from active snapshots and nonterminal workflow pins. Compute live
source-zero hashes from the running kernel declaration set plus pins. Delete only immutable rows and
materialized files absent from every live set, with transaction/concurrency behavior safe under
ingestion, invalidation rebuilds, workflow starts/completions, and repeated cleanup.

## Acceptance criteria

- [x] Active plugin snapshot scripts are retained
- [x] Running and suspended workflow pins retain exact historical script rows and module files
- [x] Completed/unpinned superseded plugin rows become candidates
- [x] Running kernel-declared source-zero hashes are retained outside the plugin snapshot
- [x] Obsolete unpinned source-zero rows become candidates
- [x] Database rows and disk modules use one content-hash liveness decision
- [x] Cleanup is idempotent and tolerates missing files/rows without hiding real failures
- [x] Concurrent ingestion, snapshot replacement, workflow start/completion, and GC cannot delete newly live content
- [x] Metrics/logging report candidates and removals without exposing source or secrets
- [x] Focused tests prove every liveness category and replay remains green after GC

## User stories addressed

- User story 30
- User story 31
- User story 32
- User story 33
- User story 36
