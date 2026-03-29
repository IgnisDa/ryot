# Migrate Person and Company Providers

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** todo

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

- [ ] All person and company provider entrypoints execute through the universal runtime.
- [ ] Shared provider implementations are imported rather than duplicated.
- [ ] Related person/company/media references preserve logical provider provenance.
- [ ] Search/details/translate outputs and canonical-language behavior remain unchanged.
- [ ] Youtubei-dependent person operations pass deterministic replay behavior.
- [ ] Cache, config, authority, and capability boundaries remain correctly narrowed.
- [ ] Focused tests and hermetic E2E pass for each provider subfamily.
- [ ] No obsolete activity or direct standard-runtime assumption is introduced.

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 6
- User story 8
- User story 13
