# Migrate Media-Group Providers

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** done

## What to build

Migrate every provider under `plugins/media/scripts/providers/media-group/` to universal workflow
execution. Preserve grouped entity contracts, related item/provider identities, translations,
provider-scoped caches, and shared implementation reuse with the item-level provider families
already migrated in Tasks 10-12.

Use the SDK-owned Youtubei adapter for grouped Youtube Music operations. Remove any group-specific
wrapper whose only purpose was the old execution boundary, narrow manifest capabilities/config keys,
and update grouped-provider package/backend tests and hermetic E2E.

## Acceptance criteria

- [x] Every media-group provider entrypoint uses the universal workflow runtime.
- [x] Group search/details/translate contracts and logical provider provenance are preserved.
- [x] Group providers reuse migrated shared API clients/parsers without duplication.
- [x] Grouped Youtube Music operations pass deterministic replay and supported adapter usage.
- [x] Provider-scoped cache sharing and executing-user isolation remain intact.
- [x] Capabilities and required configuration remain correctly narrowed per entrypoint.
- [x] Focused package/backend tests and hermetic grouped-provider E2E pass.
- [x] After this task, no production media provider remains on the standard execution model.

## Completion Notes

- Confirmed all 23 grouped provider entrypoints for Audible, GiantBomb, Hardcover, IGDB, Metron,
  MusicBrainz, Spotify, TMDB, TVDB, and YouTube Music are provider-kind scripts routed through the
  universal runtime.
- Added a media manifest regression test that checks every media-group provider maps to its exact
  details/search/translate operation set and that the complete 23-entrypoint catalog is present.
- Preserved grouped entity relationships and logical item-provider provenance while reusing the
  existing shared API clients/parsers. Grouped YouTube Music continues to use the SDK-owned adapter.

## Verification

- `bun turbo --filter=@ryot/media-plugin check`
- `bun turbo --filter=@ryot/media-plugin test --only -- 'scripts/providers/media-group/audible.test.ts' 'scripts/providers/media-group/giant-bomb.test.ts' 'scripts/providers/media-group/hardcover.test.ts' 'scripts/providers/media-group/igdb.test.ts' 'scripts/providers/media-group/metron.test.ts' 'scripts/providers/media-group/music-brainz.test.ts' 'scripts/providers/media-group/spotify.test.ts' 'scripts/providers/media-group/tmdb.test.ts' 'scripts/providers/media-group/tvdb.test.ts' 'scripts/providers/media-group/youtube-music.test.ts' 'manifest.test.ts'`
- `bun turbo --filter=@ryot/tests check`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/plugins/media/media-groups.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/entity-import/entity-import.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/entity-schemas/search-import.test.ts'`

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 6
- User story 8
- User story 13
