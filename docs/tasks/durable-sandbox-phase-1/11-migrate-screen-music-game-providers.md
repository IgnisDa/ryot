# Migrate Screen, Music, and Game Providers

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** todo

## What to build

Migrate media provider entrypoints under movie, show, music, and video-game directories. Preserve
TMDB/TVDB/Spotify/MusicBrainz/YouTube Music/IGDB/GiantBomb shared clients, provider operations,
authentication/config access, cache behavior, translations, related entities, and current result
contracts.

Use the SDK-owned Youtubei adapter established in Task 03 for all Youtube Music scripts. Durable HTTP
remains immediate and inline in Phase 1. Keep shared implementation modules thin and deterministic,
update manifest metadata/capabilities, and migrate hermetic provider tests/E2E by provider family.

## Acceptance criteria

- [ ] All movie, show, music, and video-game provider entrypoints use universal workflow execution.
- [ ] Provider search/details/resolve/translate behavior and provenance remain unchanged.
- [ ] Youtube Music entrypoints consume the supported SDK adapter and pass replay/restart coverage.
- [ ] TMDB trending/resolve/shared-client behavior is not duplicated across wrappers.
- [ ] Authentication/config results and HTTP headers remain durable but absent from diagnostics.
- [ ] Provider cache sharing and executing-user isolation remain intact.
- [ ] Focused plugin/backend tests and hermetic provider E2E pass for every migrated family.
- [ ] Controlled provider benchmarks are collected for final Task 15 comparison.

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 6
- User story 8
- User story 12
- User story 13
