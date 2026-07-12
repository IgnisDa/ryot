# Codebase Cleanup

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** done

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was
introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to duplicate
code, duplicate or alias-only types, dead code, unnecessary exports, shallow wrappers, stale support
artifacts, and speculative abstractions. The cleanup is scoped to touched files and directly affected
modules, not unrelated opportunistic refactors.

Remove temporary purity exceptions, obsolete native library names and wrappers, compatibility
re-exports, dead provenance scaffolding, stale generated assumptions, resolved migration comments,
and task-only fixtures. Preserve useful negative tests, private platform adapters, and intentional
Phase 5 deferrals. Re-run the complete Phase 4 verification matrix after cleanup.

## Acceptance criteria

- [x] The task is executed using the `codebase-cleanup` skill
- [x] The cleanup pass covers all files touched by this plan and any directly affected modules
- [x] Any removals or simplifications are reflected in the changed code before the plan is considered complete
- [x] No temporary compatibility path, task-linked purity exception, dead wrapper, or speculative Phase 5 abstraction remains
- [x] The backup client and its owner-requested deletion TODOs remain intact
- [x] Backend checks/unit tests and plugin package tests pass; the owner explicitly waived fresh Task 18 standard and standalone operational e2e runs

## Completion record

Focused audits covered every file in the Phase 4 implementation range and directly affected call
sites. Cleanup removed the unused exported `ImportSourceCatalogLive` layer, replaced the duplicate
`PluginSnapshot` alias with the loader-owned `PluginRegistrySnapshot`, made
`SandboxWorkflowReference` repository-private, and deleted the unreferenced
`waitForInLibraryRelationship` e2e helper. Repository-wide searches found no remaining consumers.
Intentional resolver and fixture boundaries were retained where they encode ownership, security,
liveness, or test semantics.

The purity gate passed across 316 production files and 869 terms with the same 1,403 justified
allowlisted findings. Backend tests passed 140 files and 978 tests after one unrelated flaky
durable-queue assertion passed its focused rerun and the full rerun. Media tests passed 95 files and
379 tests; fitness tests passed 13 files and 43 tests. The owner explicitly waived fresh Task 18
standard and operational e2e runs, so no new e2e pass is claimed. The live-network gate remained
excluded. The backup client and all four owner-requested future-deletion TODOs remain intact.

## User stories addressed

- User story 53
