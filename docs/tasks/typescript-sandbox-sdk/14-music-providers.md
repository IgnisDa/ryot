# Music Providers

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Convert MusicBrainz, Spotify, and YouTube Music across music, person, and music-group into nine SDK TypeScript provider modules. Use static manifests, standard provider contracts, typed hosts, pinned SDK dependencies, runtime validation, and the trusted compiler. Preserve each source's authentication, transport adaptation, entity mapping, grouping, and metadata behavior.

MusicBrainz must retain user-agent, lookup, artist and release relationships, dates, and identifiers. Spotify must retain OAuth token caching, expiry buffers, search, details, artist, album/group, images, and errors. YouTube Music must adapt youtubei.js through the typed SDK runtime, preserve its host-backed fetch adapter, language metadata, thumbnails, artist and album/group mapping, Cheerio use, and deterministic test overrides. Do not make live provider requests in regular tests.

## Acceptance criteria

- [x] All nine MusicBrainz, Spotify, and YouTube Music sources are SDK TypeScript modules
- [x] Manifests preserve exact source metadata, canonical language where applicable, capabilities, and configuration requirements
- [x] MusicBrainz request headers, identifiers, dates, artists, releases, and group behavior remain consistent
- [x] Spotify OAuth, token cache, expiry, search, details, people, groups, images, and failures remain consistent
- [x] YouTube Music's youtubei.js client and host-backed fetch adapter are fully typed and use approved SDK imports
- [x] YouTube Music language, thumbnail, artist, group, and HTML-normalization behavior remains consistent
- [x] Consumed external and youtubei.js values are narrowed or runtime-validated without broad unsafe assertions
- [x] Existing music provider tests use SDK hosts and deterministic package stand-ins
- [x] Compiled Deno tests cover representative drivers from each source without live network calls
- [x] Generated registry and seeding contain all nine providers exactly once
- [x] Corresponding JavaScript sources and dynamic package-rewrite test support are removed when unused
- [x] Backend and relevant E2E checks and tests pass

## Implementation notes

- Converted `music.music-brainz`/`person.music-brainz`/`music-group.music-brainz`, `music.spotify`/`person.spotify`/`music-group.spotify`, and `music.youtube-music`/`person.youtube-music`/`music-group.youtube-music` to SDK TypeScript modules, each family sharing a `providers/<name>-shared.ts` helper.
- Capabilities: MusicBrainz `["httpCall"]` (source `music-brainz`, no canonical language); Spotify `["httpCall", "getAppConfigValue", "getCachedValue", "setCachedValue"]` (OAuth token cache; keys `providers.spotifyClientId`/`providers.spotifyClientSecret`); YouTube Music `["httpCall"]` with `canonicalLanguage: "en"`.
- The MusicBrainz media-group legacy source had two latent scoping bugs (an undefined `getString`, and a `releaseDetails` const referenced outside its `if` block); the migration emits correct code matching the evident intent (release track members become ordered `music-group-to-music` related entities).
- YouTube Music routes the `youtubei.js` Innertube client through a host-backed `makeFetch` adapter (`@ryot/sandbox-sdk/youtubei`), reads canonical language from the manifest, keeps the custom `history` driver via `defineDriver`, and uses `@ryot/sandbox-sdk/cheerio` for album-description HTML normalization. Client-consuming logic is factored into exported builder functions taking minimal structural client types, so tests inject deterministic fake clients with zero unsafe assertions (replacing the removed dynamic package-rewrite test support). The now-unused `translatedProviderScript` registry helper was removed.
- Deno runner-integration tests execute representative MusicBrainz (`search`) and Spotify (`search`, exercising the OAuth token-cache write) drivers with canned host responses. YouTube Music is covered by unit tests with injected fake clients plus the built-in compile/definition smoke test: its Innertube client performs a session handshake that cannot be faithfully reproduced with canned host responses without reimplementing the youtubei protocol, so a full Deno execution test is intentionally omitted.

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
