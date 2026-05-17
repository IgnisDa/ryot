# Migrate Media Integration Scripts

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** done

## What to build

Migrate every media integration yank/sink script under `plugins/media/scripts/integrations/` from
activity execution to the universal workflow body. Preserve provider-specific settings, private/local
destinations, insecure-TLS opt-in, authentication, parsing, and current integration result contracts.

All backend reads/writes use durable host boundaries. External HTTP mutations remain explicitly
at-least-once: do not add generic retries or exactly-once machinery, and keep any remote idempotency
headers already supported. Replace ambient current-time usage with persisted execution `startedAt`.
Update integration manifests, runtime tests, plugin tests, and hermetic E2E in the same slice, then
delete the migrated activity definitions/references while retaining temporary global compatibility
for remaining fitness imports.

## Acceptance criteria

- [x] Every media yank and sink integration executes as a universal replayable sandbox workflow.
- [x] Private Plex/Jellyfin/Kodi/Emby/Komga/Audiobookshelf and similar destinations remain usable.
- [x] Credentials remain available only through authorized host calls and never enter diagnostics.
- [x] External mutations have no new automatic business retry and are documented as at-least-once.
- [x] Current-time fields derive from deterministic execution metadata rather than ambient Date APIs.
- [x] Completed durable reads/writes are replayed without repetition; accepted external crash-window
      duplication is covered/documented separately from application-write idempotency.
- [x] Migrated integration activity definitions and manifest references are deleted.
- [x] Focused integration/plugin/backend tests and affected integration E2E pass with assertions
      preserved.

## Completion Notes

- Converted all four media yank and six media sink definitions from `defineActivity` to `defineScript`
  with `script` manifests, so the existing universal resolver dispatches them as durable sandbox child
  workflows.
- Routed integration-generated event timestamps and YouTube Music deduplication windows through the
  persisted execution `startedAt` metadata. Historical timestamps supplied by Plex remain unchanged.
- Preserved authorized integration host access, private/local destination settings, insecure-TLS
  behavior, and at-least-once external mutation semantics without adding retries.
- Kept the temporary internal activity request shape used by the remaining import and fitness migration
  compatibility; the backend already resolves migrated `script` targets as `SandboxScriptWorkflow`
  children.

## Verification

- `bun turbo --filter=@ryot/media-plugin check`
- `bun --bun run vitest run scripts/integrations/integration-adapters.test.ts scripts/integrations/yank-adapters.test.ts manifest.test.ts`
- `bun --bun run vitest run src/modules/integrations/integration-workflow.test.ts src/modules/integrations/service.test.ts src/modules/plugins/integration-provider-catalog.test.ts`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/plugins/media/integrations/integrations.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/integrations/integrations.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/sandbox/integrations.test.ts'`

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 5
- User story 13
