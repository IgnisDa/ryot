# Migrate Media Imports and Named Workflows

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** todo

## What to build

Migrate the media plugin's import and named-workflow graph using the completed universal runtime,
dispatcher, and artifact model. Convert the import orchestration workflows, parser activities,
resolution/population/monitoring workflows, provider-resolution wrappers, episode resolution, and
chunk writing under `plugins/media/scripts/imports/` and `plugins/media/scripts/workflows/`.

Named workflows should call durable host functions directly. Inline wrappers that existed only
because workflows lacked capabilities; retain named child workflows only for genuine independent
durability, fan-out, reuse, or payload boundaries. Convert import file/chunk flow to immutable inputs
and durable handles, preserve current chunking and provider resolution behavior, and update manifest
references plus media import/kernel import E2E in the same slice. Retire migrated activity entries,
but do not remove the global activity SDK/compiler compatibility still needed by Tasks 07-09.

## Acceptance criteria

- [ ] Every media import source executes through the universal sandbox workflow runtime.
- [ ] Import parsers, resolution, population, monitoring, episode resolution, and chunk output use
      durable host/child boundaries without replay-unsafe scratch state.
- [ ] Named workflows call HTTP/query/config/write host functions directly where wrappers are no
      longer meaningful.
- [ ] Infrastructure-only media import/workflow activity scripts and manifest references are deleted.
- [ ] Genuine fan-out and bounded-payload child workflow boundaries remain deterministic.
- [ ] Existing import result, failure, population, relationship, and event behavior is preserved.
- [ ] Media import fixtures use workflow-lifetime artifact handles and no obsolete activity kind.
- [ ] Focused media plugin tests, backend import/workflow tests, kernel/media import E2E, and affected
      operational-gate setup pass.
- [ ] Package checks remain green and no standard-runtime branch is added for import parsing.

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 7
- User story 8
- User story 13
