# Integrations And Webhooks

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** done

## What to build

Migrate integrations, scheduled runs, sink/yank provider behavior, app-owned webhook routes, and the short integration webhook path after the import runtime is available. Resolve the old imports/integrations cycle by using shared Effect services and workflow orchestration rather than a shared BullMQ import queue.

This slice should preserve public webhook paths and typed route contracts while moving provider execution into the new architecture.

## Acceptance criteria

- [x] Authenticated users can list, create, get, patch, and delete integrations
- [x] Authenticated users can list integration runs
- [x] Scheduled integration reconciliation uses Effect-native scheduling/workflow primitives
- [x] App-owned integration webhook routes process sink payloads through migrated services
- [x] The short integration webhook path remains served outside or alongside the app-owned contract as appropriate
- [x] Integration E2E tests pass through the Effect client or raw fetch for webhook payloads as needed

## Notes

- Migrated the integrations contract, repository, service, worker, and scheduler to Effect-native layers and durable workflow primitives.
- Preserved the short `/_i/:integrationId` webhook path by forwarding it into the app-owned integrations webhook handler while tolerating bodyless webhook posts.
- Threaded `integrationId` and `importRunId` into event creation so integration-origin events keep trigger context.
- Removed the integrations-specific `TODO(Task 22)` tests-only typing bridge now that the contract exposes typed integration fields.
- Ported all sink providers (`emby`, `jellyfin_sink`, `plex_sink`, `kodi`, `ryot_browser_extension`) into `modules/integrations/sinks`; `generic_json` stays a stub to match legacy. Widened the webhook ingestion to forward the raw body + content-type so multipart Plex payloads parse.
- Ported the `komga` yank provider (`modules/integrations/yank/komga.ts`), mapping links to resolved `manga.anilist` / `manga.myanimelist` / `manga.manga-updates` refs.
- Implemented `syncOwnership` end-to-end: owned-items fetchers for audiobookshelf, plex_yank, and komga, plus `markEntityOwnedInLibrary` + the ownership write in the shared media pipeline (`modules/imports/media/write.ts`).
- Ported the `youtube_music` yank provider as a sandbox driver: a `history` driver on the `music.youtube-music` script fetches today's listens via Innertube, and the app applies the Redis dedup (35% first-seen / 100% repeat) + progress events.

## Verification

- `bun turbo --filter=@ryot/app-backend check`
- `bun test src/tests/integrations.test.ts --timeout 60000`

## User stories addressed

Reference by number from the parent PRD:

- User story 25
- User story 27
- User story 28
- User story 43
