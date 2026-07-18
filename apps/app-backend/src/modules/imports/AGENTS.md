# Imports Module

This module owns one-time import dispatch, artifacts, progress, failures, and generic writes.

- Plugin adapters receive trusted artifacts through sandbox filesystem grants and emit manifests of generic write chunks; plugins never write imported domain data directly.
- `kernel:process-import-chunks` owns chunk consumption, deletion, counters, alias resolution, writes, and event workflow composition.
- Keep source-specific normalization and schema slugs in the owning plugin.

## Failure stages

- `input_transformation`: parsing or normalization failures.
- `provider_resolution`: unresolved ref could not be mapped to a supported provider id.
- `provider_details`: sandbox `details` fetch or entity population failure.
- `event_policy`: failure while evaluating a policy before an imported event is written.
- `database_commit`: collections, events, or library membership writes failed.
- `source_fetch`: source payload or external source fetch failed before normalization.

## Changes

- New sources declare metadata and workflows in their plugin manifest, parse artifacts in a plugin activity, and compose the kernel generic-import child.
- Keep orchestration tests beside the owning workflow, helper tests beside helpers, and source-specific tests in the plugin package.
