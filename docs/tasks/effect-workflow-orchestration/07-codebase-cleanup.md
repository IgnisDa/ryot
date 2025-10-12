# Codebase Cleanup

**Parent Plan:** [Effect Workflow Orchestration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to duplicate code, duplicate or alias-only types, dead code, unnecessary exports, shallow wrappers, stale support artifacts, and speculative abstractions. The cleanup is scoped to touched files and directly affected modules, not unrelated opportunistic refactors. Make sure there is minimal duplicated code between all the migrated workflows.

## Acceptance criteria

- [ ] The task is executed using the `codebase-cleanup` skill
- [ ] The cleanup pass covers all files touched by this plan and any directly affected modules
- [ ] Any removals or simplifications are reflected in the changed code before the plan is considered complete
- [ ] The known cleanup items below are resolved or explicitly justified

## Known cleanup items

These were discovered while implementing earlier tasks and intentionally deferred here to keep those tasks focused. Verify each is still dead before removing.

### Orphaned media pass-through processors (from Task 03)

Task 03 deleted the one-time import queue worker and `runtime/processor-registry.ts`, which was the only caller of the per-source media `process*Import` pipeline functions. After that removal these became dead code (each is now referenced only within its own file). The co-located `load*AdapterResult` / `adapt*` exports are still live (used by `media/source-loaders.ts`) and must stay.

- Remove the now-dead `process*Import` function, keeping the rest of the file:
  - `processMovaryImport` in `sources/movary/processor.ts` (keep `loadMovaryAdapterResult`)
  - `processNetflixImport` in `sources/netflix/processor.ts` (keep `loadNetflixAdapterResult`)
  - `processMyanimelistImport` in `sources/myanimelist/processor.ts` (keep `loadMyanimelistAdapterResult`)
  - `processMediaTextFileImport` in `media/file-processor.ts` (keep `loadMediaTextFileAdapterResult`)
- Delete the entire file (its only export is the dead `process*Import`):
  - `sources/plex/processor.ts`
  - `sources/trakt/processor.ts`
  - `sources/jellyfin/processor.ts`
  - `sources/media-tracker/processor.ts`
  - `sources/audiobookshelf/processor.ts`

### Duplicated workflow orchestration helpers

`workflows.ts` (media) and `workflows-non-media.ts` each define their own copies of the run-lifecycle helpers (`toWorkflowError`, `cleanupArtifacts` / `cleanupArtifactsBestEffort`, `markRunFailed`, `failRunAndCleanup`, and the progress-reporter logic). Consider extracting the shared pieces into one support module used by both, without over-abstracting.
