# Migrate Media Imports and Named Workflows

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** done

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

- [x] Every media import source executes through the universal sandbox workflow runtime.
- [x] Import parsers, resolution, population, monitoring, episode resolution, and chunk output use
      durable host/child boundaries without replay-unsafe scratch state.
- [x] Named workflows call HTTP/query/config/write host functions directly where wrappers are no
      longer meaningful.
- [x] Infrastructure-only media import/workflow activity scripts and manifest references are deleted.
- [x] Genuine fan-out and bounded-payload child workflow boundaries remain deterministic.
- [x] Existing import result, failure, population, relationship, and event behavior is preserved.
- [x] Media import fixtures use workflow-lifetime artifact handles and no obsolete activity kind.
- [x] Focused media plugin tests, backend import/workflow tests, kernel/media import E2E, and affected
      operational-gate setup pass.
- [x] Package checks remain green and no standard-runtime branch is added for import parsing.

## Completion Notes

- Converted media import parsers, episode resolution, chunk writing, provider-resolution wrappers, and
  monitoring target lookup from `activity` definitions to ordinary script definitions with renamed
  manifest/catalog references.
- Migrated script targets continue to use the existing internal activity request shape while the
  backend resolves them as deterministic `SandboxScriptWorkflow` children. Remaining activity SDK and
  compiler compatibility is unchanged for later migration tasks.
- Propagated harvested chunk files to opaque workflow-lifetime handles at the universal workflow
  terminal boundary, and migrated the kernel harvest-handle fixture to the script definition model.
- Preserved media workflow fan-out, provider resolution order, import chunking, failure reporting, and
  kernel import contracts.

## Verification

- `bun turbo --filter=@ryot/media-plugin check`
- `bun turbo --filter=@ryot/media-plugin test`
- `bun turbo --filter=@ryot/app-backend check`
- `bun turbo --filter=@ryot/app-backend test`
- `bun turbo --filter=@ryot/tests check`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/imports/imports.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/plugins/media/imports/imports.test.ts'`
- `RUN_OPERATIONAL_GATES=1 bun turbo --filter=@ryot/tests test --only -- 'src/tests/plugins/media/imports/media-population-operational-gate.test.ts'`

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 7
- User story 8
- User story 13
