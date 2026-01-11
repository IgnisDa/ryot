# Music Providers

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Convert MusicBrainz, Spotify, and YouTube Music across music, person, and music-group into nine SDK TypeScript provider modules. Use static manifests, standard provider contracts, typed hosts, pinned SDK dependencies, runtime validation, and the trusted compiler. Preserve each source's authentication, transport adaptation, entity mapping, grouping, and metadata behavior.

MusicBrainz must retain user-agent, lookup, artist and release relationships, dates, and identifiers. Spotify must retain OAuth token caching, expiry buffers, search, details, artist, album/group, images, and errors. YouTube Music must adapt youtubei.js through the typed SDK runtime, preserve its host-backed fetch adapter, language metadata, thumbnails, artist and album/group mapping, Cheerio use, and deterministic test overrides. Do not make live provider requests in regular tests.

## Acceptance criteria

- [ ] All nine MusicBrainz, Spotify, and YouTube Music sources are SDK TypeScript modules
- [ ] Manifests preserve exact source metadata, canonical language where applicable, capabilities, and configuration requirements
- [ ] MusicBrainz request headers, identifiers, dates, artists, releases, and group behavior remain consistent
- [ ] Spotify OAuth, token cache, expiry, search, details, people, groups, images, and failures remain consistent
- [ ] YouTube Music's youtubei.js client and host-backed fetch adapter are fully typed and use approved SDK imports
- [ ] YouTube Music language, thumbnail, artist, group, and HTML-normalization behavior remains consistent
- [ ] Consumed external and youtubei.js values are narrowed or runtime-validated without broad unsafe assertions
- [ ] Existing music provider tests use SDK hosts and deterministic package stand-ins
- [ ] Compiled Deno tests cover representative drivers from each source without live network calls
- [ ] Generated registry and seeding contain all nine providers exactly once
- [ ] Corresponding JavaScript sources and dynamic package-rewrite test support are removed when unused
- [ ] Backend and relevant E2E checks and tests pass

## User stories addressed

- User story 1
- User story 3
- User story 4
- User story 11
- User story 31
- User story 32
- User story 33
- User story 34
- User story 35
- User story 36
- User story 39
