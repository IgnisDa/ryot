# One-Time Media Import Workflow Orchestration

**Parent Plan:** [Effect Workflow Orchestration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Refactor one-time media import runs so media sources execute through workflow-owned durable phases instead of hiding the media pipeline inside one import-run queue worker. Introduce or reshape shared workflow-friendly media import orchestration that can later be reused by integration runs.

The media import workflow path should load and mark the import run, load source payloads or temporary files, run the source adapter, record adapter row-level failures, update totals and progress, resolve unresolved entity refs through workflow-owned sandbox resolve steps, populate resolved entities through the entity import/population workflow path, write collections and events through owning services, clean sensitive stored source payloads or temporary files, and finalize the run.

This task should cover one-time media import sources. Non-media one-time sources such as workout and measurement imports may remain for the next task, but any temporary bridge must be scoped clearly and must not be mistaken for the final architecture.

## Acceptance criteria

- [ ] One-time media imports execute through explicit workflow phases instead of one opaque import-run queue worker
- [ ] Shared media import orchestration exists behind a stable workflow-friendly interface for adapter result handling, failure recording, progress reporting, entity resolution, entity population, event and collection writes, and final counters
- [ ] Media source adapter loading is represented as a durable activity or bounded durable queue step according to the adapter's work and retry semantics
- [ ] Adapter row-level failures are recorded as item failures without failing the entire run
- [ ] Catastrophic source-fetch, credential, or adapter failures fail the run through a durable failure-recording step
- [ ] Media entity resolution no longer calls sandbox through raw workflow-engine execution from helpers
- [ ] Media entity population reuses workflow-owned entity import or population orchestration rather than helper-level raw workflow-engine execution
- [ ] Media writes continue to use owning module services for collections, events, and library state
- [ ] Source payload and temporary file cleanup happens as durable finalization work
- [ ] Existing one-time media import behavior remains product-compatible for run status, progress, counters, item failures, populated entities, collection writes, and event writes
- [ ] Tests cover a successful media import, adapter row-level failures, catastrophic adapter failure, entity resolution, entity population, media writes, progress/final counters, and cleanup of stored source payloads or temporary files where applicable

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 2
- User story 4
- User story 6
- User story 7
- User story 9
- User story 11
- User story 13
- User story 15
- User story 16
- User story 17
- User story 23
- User story 25
- User story 26
- User story 28
- User story 29
- User story 30
- User story 31
- User story 32
- User story 33
