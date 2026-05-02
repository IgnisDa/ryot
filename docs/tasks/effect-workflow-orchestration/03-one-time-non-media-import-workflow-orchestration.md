# One-Time Non-Media Import Workflow Orchestration

**Parent Plan:** [Effect Workflow Orchestration](./README.md)

**Type:** AFK

**Status:** done

## What to build

Finish the one-time import workflow refactor by moving non-media import sources into workflow-owned durable orchestration. This includes import paths that do not use the shared media entity resolution/population/write pipeline, such as measurement and workout imports.

The one-time import workflow should own source dispatch for all supported one-time import sources after this task. Non-media processors should use durable activities or bounded durable queue steps for file/source loading, adapter parsing, domain writes, failure recording, cleanup, and run finalization. Domain mutations must still go through owning services or repositories according to existing module boundaries, and database transactions must not cross durable workflow boundaries.

After this task, the one-time import workflow should no longer have a temporary whole-run queue-worker fallback for any supported source.

## Acceptance criteria

- [x] All supported one-time import sources are started and orchestrated by the one-time import workflow
- [x] Non-media import source loading and parsing are represented as durable activities or bounded durable queue steps
- [x] Non-media domain writes use the owning modules' write paths and are replay-safe
- [x] Non-media item-level failures and catastrophic run failures preserve existing product behavior
- [x] Source payload and temporary file cleanup is durable and applies to non-media sources where relevant
- [x] The old whole-run import queue worker is removed or reduced to a bounded step with a clear durable queue purpose
- [x] The import workflow `toLayer` is not a single pass-through durable queue call for any supported one-time import path
- [x] Tests cover at least one measurement import path and one workout import path, including successful writes, failure recording, run finalization, and cleanup behavior where applicable

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 2
- User story 4
- User story 9
- User story 13
- User story 15
- User story 17
- User story 26
- User story 27
- User story 29
- User story 30
- User story 31
- User story 32
- User story 33
