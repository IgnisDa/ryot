# Codebase Cleanup

**Parent Plan:** [Effect Workflow Orchestration](./README.md)

**Type:** AFK

**Status:** done

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to duplicate code, duplicate or alias-only types, dead code, unnecessary exports, shallow wrappers, stale support artifacts, and speculative abstractions. The cleanup is scoped to touched files and directly affected modules, not unrelated opportunistic refactors. Make sure there is minimal duplicated code between all the migrated workflows.

## Acceptance criteria

- [x] The task is executed using the `codebase-cleanup` skill
- [x] The cleanup pass covers all files touched by this plan and any directly affected modules
- [x] Any removals or simplifications are reflected in the changed code before the plan is considered complete
- [x] The known cleanup items below are resolved or explicitly justified

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

## Implementation notes

- **Files:** `apps/app-backend/src/modules/imports/runtime/workflow-helpers.ts`, `apps/app-backend/src/modules/imports/workflows.ts`, `apps/app-backend/src/modules/imports/workflows-non-media.ts`, `apps/app-backend/src/modules/imports/worker.ts`, `apps/app-backend/src/modules/imports/measurement/workflow.ts`, `apps/app-backend/src/modules/imports/workout/workflow.ts`
- Extracted the duplicated import-run lifecycle pieces into `runtime/workflow-helpers.ts`, including `ImportRunError`, `toWorkflowError`, cleanup activities, and fail-and-cleanup orchestration.
- The media progress reporter intentionally stayed local to `workflows.ts` because the media workflow reports phase-based progress while `workflows-non-media.ts` reports linear per-item progress.

- **Files:** `apps/app-backend/src/modules/imports/media/import-processor.ts`, `apps/app-backend/src/modules/imports/media/file-processor.ts`, `apps/app-backend/src/modules/imports/sources/movary/processor.ts`, `apps/app-backend/src/modules/imports/sources/myanimelist/processor.ts`
- Removed the dead pass-through `process*Import` functions while keeping the live adapter-result loaders.
- Replaced the hand-written media adapter result types with schema-derived types so the loader and workflow layers share one canonical shape.

- **Files removed:** `apps/app-backend/src/modules/imports/media/resolve.ts`, `apps/app-backend/src/modules/imports/media/populate.ts`, `apps/app-backend/src/modules/imports/media/write.ts`, `apps/app-backend/src/modules/imports/sources/plex/processor.ts`, `apps/app-backend/src/modules/imports/sources/trakt/processor.ts`, `apps/app-backend/src/modules/imports/sources/jellyfin/processor.ts`, `apps/app-backend/src/modules/imports/sources/media-tracker/processor.ts`, `apps/app-backend/src/modules/imports/sources/audiobookshelf/processor.ts`
- Deleted the transitive dead media pipeline helpers and API-source processors that only existed to support the removed pass-through import pipeline.

- **Files:** `apps/app-backend/src/modules/entities/population.ts`, `apps/app-backend/src/modules/imports/AGENTS.md`, `apps/app-backend/AGENTS.md`, `apps/app-backend/src/lib/sandbox/README.md`
- Trimmed `entities/population.ts` down to the still-live decode and related-entity helpers.
- Updated stale backend/import/sandbox guidance so the repository docs match the workflow-owned orchestration architecture.

- **Verification:** `bun run test 'src/modules/imports/workflows.test.ts' 'src/modules/imports/workflows-non-media.test.ts' 'src/modules/entities/workflows.test.ts' 'src/modules/integrations/workflows.test.ts'`
- **Verification:** `bun turbo --filter=@ryot/app-backend check`
