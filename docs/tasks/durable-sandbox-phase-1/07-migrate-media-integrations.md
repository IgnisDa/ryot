# Migrate Media Integration Scripts

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** todo

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

- [ ] Every media yank and sink integration executes as a universal replayable sandbox workflow.
- [ ] Private Plex/Jellyfin/Kodi/Emby/Komga/Audiobookshelf and similar destinations remain usable.
- [ ] Credentials remain available only through authorized host calls and never enter diagnostics.
- [ ] External mutations have no new automatic business retry and are documented as at-least-once.
- [ ] Current-time fields derive from deterministic execution metadata rather than ambient Date APIs.
- [ ] Completed durable reads/writes are replayed without repetition; accepted external crash-window
      duplication is covered/documented separately from application-write idempotency.
- [ ] Migrated integration activity definitions and manifest references are deleted.
- [ ] Focused integration/plugin/backend tests and affected integration E2E pass with assertions
      preserved.

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 5
- User story 13
