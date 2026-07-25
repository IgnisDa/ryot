# Migrate Screen, Music, and Game Providers

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** done

## What to build

Migrate media provider entrypoints under movie, show, music, and video-game directories. Preserve
TMDB/TVDB/Spotify/MusicBrainz/YouTube Music/IGDB/GiantBomb shared clients, provider operations,
authentication/config access, cache behavior, translations, related entities, and current result
contracts.

Use the SDK-owned Youtubei adapter established in Task 03 for all Youtube Music scripts. Durable HTTP
remains immediate and inline in Phase 1. Keep shared implementation modules thin and deterministic,
update manifest metadata/capabilities, and migrate hermetic provider tests/E2E by provider family.

## Acceptance criteria

- [x] All movie, show, music, and video-game provider entrypoints use universal workflow execution.
- [x] Provider search/details/resolve/translate behavior and provenance remain unchanged.
- [x] Youtube Music entrypoints consume the supported SDK adapter and pass replay/restart coverage.
- [x] TMDB trending/resolve/shared-client behavior is not duplicated across wrappers.
- [x] Authentication/config results and HTTP headers remain durable but absent from diagnostics.
- [x] Provider cache sharing and executing-user isolation remain intact.
- [x] Focused plugin/backend tests and hermetic provider E2E pass for every migrated family.
- [x] Controlled provider benchmarks are collected for final Task 15 comparison.

## Completion Notes

- Confirmed the movie, show, music, and video-game provider catalog uses the shared universal workflow
  routing and existing provider-specific clients/manifests without duplicated wrappers.
- Replaced YouTube Music history's ambient current date with the persisted workflow `startedAt`, and
  passed that value through both the history script and integration yank entrypoints.
- Kept the SDK-owned Youtubei adapter as the production client while using injected Effect-returning
  client factories for focused deterministic tests.

## Verification

- `bun turbo --filter=@ryot/media-plugin check`
- `bun turbo --filter=@ryot/media-plugin test --only -- 'scripts/providers/media/movie/tmdb.test.ts' 'scripts/providers/media/movie/tvdb.test.ts' 'scripts/providers/media/show/tmdb.test.ts' 'scripts/providers/media/show/tvdb.test.ts' 'scripts/providers/media/music/spotify.test.ts' 'scripts/providers/media/music/music-brainz.test.ts' 'scripts/providers/media/music/youtube-music.test.ts' 'scripts/providers/media/video-game/igdb.test.ts' 'scripts/providers/media/video-game/giant-bomb.test.ts'`
- `bun turbo --filter=@ryot/media-plugin test --only -- 'scripts/integrations/yank-adapters.test.ts'`
- `bun turbo --filter=@ryot/app-backend check`
- `bun turbo --filter=@ryot/app-backend test`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/entity-import/entity-import.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/entity-schemas/search-import.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/entity-translation/entity-translation.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/plugins/plugins.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/sandbox/cache.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/sandbox/youtubei-tracer.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/plugins/media/crons/media-trending-cron.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/plugins/media/integrations/integrations.test.ts'`

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 6
- User story 8
- User story 12
- User story 13
