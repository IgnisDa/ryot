# Superseded Script and Module GC

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** done

## What to build

Implement script-row and disk-module garbage collection using the liveness model established by task 13. Read the overview, Phase 4 plan, parent PRD, this task, and task 13's completed decision record
before implementation.

Compute live plugin hashes from active snapshots, nonterminal workflow pins, and every historical
script owned by a pinned plugin. Retain all persisted source-zero hashes across running kernel
versions. Delete only immutable rows and materialized files absent from every live set, with transaction/concurrency behavior safe under
ingestion, invalidation rebuilds, workflow starts/completions, and repeated cleanup.

## Acceptance criteria

- [x] Active plugin snapshot scripts are retained
- [x] Running and suspended workflow pins retain every historical script row and module file for their plugin
- [x] Completed/unpinned superseded plugin rows become candidates
- [x] Persisted source-zero hashes are retained outside the plugin snapshot across rolling deployments
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
