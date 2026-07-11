# Imports Module

## Purpose

This module owns the framework for one-time import runs: registry dispatch, artifact lifecycle,
run progress and failures, and generic entity, event, relationship, and ownership writes.

## Directory layout

- `routes.ts`, `service.ts`, `repository.ts`, `jobs.ts`, `import-run-workflow.ts`: HTTP, workflow entry, persistence, and shared import-run types. (`schemas.ts` lives in `@ryot/contract`.)
- `runtime/`: artifact handling, source payload storage, shared failures, and workflow helpers.
- `plugin-import-workflow.ts`, `generic-import-workflow.ts`: registry dispatch and kernel-owned generic chunk writes.

## Plugin import pipeline

Registry-declared imports receive trusted artifacts only through sandbox filesystem grants. Adapter
activities parse those artifacts and return manifests naming harvested generic write chunks. The
`kernel:process-import-chunks` child consumes and deletes those kernel-owned files, records adapter
and write failures, updates run counters, resolves aliases, performs entity/relationship writes, and
awaits `EventCreateWorkflow` with deterministic child ids. Plugins never write import data directly.

## Failure stages

Use the existing import failure stages consistently:

- `input_transformation`: parsing or normalization failures.
- `provider_resolution`: unresolved ref could not be mapped to a supported provider id.
- `provider_details`: sandbox `details` fetch or entity population failure.
- `event_policy`: failure while evaluating a policy before an imported event is written.
- `database_commit`: collections, events, or library membership writes failed.
- `source_fetch`: source payload or external source fetch failed before normalization.

## Adding a new importer

For a new source:

1. Declare source metadata and its workflow in the owning plugin manifest.
2. Parse source artifacts in a plugin activity and emit generic import chunks.
3. Keep source-specific normalization and schema slugs in the plugin.
4. Compose the kernel generic import child for writes, counters, and failure rows.
5. Follow the source-ingestion versus provider catalog boundary rules.
6. Add focused adapter, helper, or workflow tests beside the new source or workflow.

## Testing expectations

- Workflow orchestration tests belong beside `plugin-import-workflow.ts` or
  `generic-import-workflow.ts`, and pure helper tests should stay beside the helper they cover.
- Source adapter and source-specific workflow tests belong in the owning plugin package.
