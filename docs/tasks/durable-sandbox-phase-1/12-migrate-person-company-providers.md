# Migrate Person and Company Providers

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** done

## What to build

Migrate every person and company provider entrypoint to universal workflow execution. These scripts
span many shared provider clients, so reuse the already migrated family implementations rather than
forking request/parsing logic. Preserve provider identity, related entity/company/person references,
translations, canonical language, cache partitions, and per-provider capability/config narrowing.

Use the SDK-owned Youtubei adapter for person Youtube Music operations and the corresponding durable
clients established by Tasks 10-11 for AniList, TMDB, TVDB, Spotify, Hardcover, Audible, VNDB,
MangaUpdates, Metron, OpenLibrary, GiantBomb, and IGDB. Update package/backend tests and hermetic
provider E2E in bounded subfamilies.

## Acceptance criteria

- [x] All person and company provider entrypoints execute through the universal runtime.
- [x] Shared provider implementations are imported rather than duplicated.
- [x] Related person/company/media references preserve logical provider provenance.
- [x] Search/details/translate outputs and canonical-language behavior remain unchanged.
- [x] Youtubei-dependent person operations pass deterministic replay behavior.
- [x] Cache, config, authority, and capability boundaries remain correctly narrowed.
- [x] Focused tests and hermetic E2E pass for each provider subfamily.
- [x] No obsolete activity or direct standard-runtime assumption is introduced.

## Completion Notes

- Confirmed person and company provider scripts use the existing universal provider runtime and shared
  clients for AniList, Audible, GiantBomb, Hardcover, IGDB, MangaUpdates, Metron, MusicBrainz,
  OpenLibrary, Spotify, TMDB, TVDB, VNDB, and YouTube Music.
- Added a media manifest regression test that checks every person/company provider declaration maps to
  the exact provider operation scripts and that no scoped entrypoint is cataloged as another script kind.
- Preserved existing related-entity provenance, provider-scoped cache/config capabilities, canonical
  language behavior, and the SDK-owned Youtubei adapter without duplicating provider implementations.

## Verification

- `bun turbo --filter=@ryot/media-plugin check`
- `bun turbo --filter=@ryot/media-plugin test --only -- 'scripts/providers/person/anilist.test.ts' 'scripts/providers/person/audible.test.ts' 'scripts/providers/person/giant-bomb.test.ts' 'scripts/providers/person/hardcover.test.ts' 'scripts/providers/person/manga-updates.test.ts' 'scripts/providers/person/metron.test.ts' 'scripts/providers/person/music-brainz.test.ts' 'scripts/providers/person/openlibrary.test.ts' 'scripts/providers/person/spotify.test.ts' 'scripts/providers/person/tmdb.test.ts' 'scripts/providers/person/tvdb.test.ts' 'scripts/providers/person/youtube-music.test.ts' 'scripts/providers/company/anilist.test.ts' 'scripts/providers/company/giant-bomb.test.ts' 'scripts/providers/company/hardcover.test.ts' 'scripts/providers/company/igdb.test.ts' 'scripts/providers/company/tmdb.test.ts' 'scripts/providers/company/tvdb.test.ts' 'scripts/providers/company/vndb.test.ts'`
- `bun turbo --filter=@ryot/tests check`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/entity-import/entity-import.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/entity-schemas/search-import.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/entity-translation/entity-translation.test.ts'`

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 6
- User story 8
- User story 13
