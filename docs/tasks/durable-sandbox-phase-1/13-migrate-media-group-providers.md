# Migrate Media-Group Providers

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** todo

## What to build

Migrate every provider under `plugins/media/scripts/providers/media-group/` to universal workflow
execution. Preserve grouped entity contracts, related item/provider identities, translations,
provider-scoped caches, and shared implementation reuse with the item-level provider families
already migrated in Tasks 10-12.

Use the SDK-owned Youtubei adapter for grouped Youtube Music operations. Remove any group-specific
wrapper whose only purpose was the old execution boundary, narrow manifest capabilities/config keys,
and update grouped-provider package/backend tests and hermetic E2E.

## Acceptance criteria

- [ ] Every media-group provider entrypoint uses the universal workflow runtime.
- [ ] Group search/details/translate contracts and logical provider provenance are preserved.
- [ ] Group providers reuse migrated shared API clients/parsers without duplication.
- [ ] Grouped Youtube Music operations pass deterministic replay and supported adapter usage.
- [ ] Provider-scoped cache sharing and executing-user isolation remain intact.
- [ ] Capabilities and required configuration remain correctly narrowed per entrypoint.
- [ ] Focused package/backend tests and hermetic grouped-provider E2E pass.
- [ ] After this task, no production media provider remains on the standard execution model.

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 6
- User story 8
- User story 13
