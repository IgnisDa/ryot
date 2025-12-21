# Game Providers

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Convert GiantBomb video-game, person, company, and video-game-group plus IGDB video-game, company, and video-game-group into seven SDK TypeScript provider modules. Use typed manifests, standard outputs, runtime validation, approved Day.js and Zod imports, typed HTTP/config/cache hosts, and trusted compilation.

Preserve GiantBomb API-key handling, request headers, pagination, descriptions, images, releases, people, companies, franchises/groups, and errors. Preserve IGDB Twitch OAuth, token cache and expiry, query-body generation, dates, images, companies, collections/groups, related entities, and errors. Keep authentication and request helpers family-local and ensure execution budgets accommodate current legitimate request counts.

## Acceptance criteria

- [x] All seven GiantBomb and IGDB sources are SDK TypeScript modules
- [x] Manifests preserve source metadata, exact capabilities, and GiantBomb/Twitch configuration requirements
- [x] GiantBomb search, details, people, companies, groups, pagination, descriptions, images, and failures remain consistent
- [x] IGDB OAuth, token caching, query generation, dates, images, companies, groups, relationships, and failures remain consistent
- [x] Consumed REST payload fields are runtime-validated and OAuth/cache values remain untrusted until parsed
- [x] Shared family helpers do not leak credentials or broaden capabilities
- [x] Existing GiantBomb and IGDB tests use typed SDK hosts and retain behavioral assertions
- [x] Compiled Deno tests cover representative GiantBomb and IGDB drivers without live network calls
- [x] Host and HTTP call budgets permit expected provider flows while still enforcing Task 05 limits
- [x] Generated registry and seeding contain all seven providers exactly once
- [x] Corresponding JavaScript sources are removed
- [x] Backend and relevant E2E checks and tests pass

## Implementation notes

- Converted GiantBomb (`video-game`, `person`, `company`, `video-game-group`) and IGDB (`video-game`, `company`, `video-game-group`) to SDK TypeScript modules, each family sharing a `providers/<name>-shared.ts` helper (`giant-bomb-shared.ts`, `igdb-shared.ts`).
- Capabilities: GiantBomb `["httpCall", "getAppConfigValue"]` (key `providers.giantBombApiKey`); IGDB `["httpCall", "getAppConfigValue", "getCachedValue", "setCachedValue"]` (Twitch OAuth token cache; keys `providers.twitchClientId`/`providers.twitchClientSecret`). Both source-only (no canonical language).
- GiantBomb GUID identifiers, prioritized image selection, `extractYear` regex, deck+description combining, franchises→groups, developers/publishers→companies, and similar-games suggestions are preserved. IGDB's Twitch client-credentials flow (token cache with `{accessToken, clientId}`, `Bearer` normalization, `Math.max(60, expires_in-300)` TTL), apicalypse query bodies (including the verbatim `offset:` colon in the collections search), per-family image bases (`t_cover_big`/`t_logo_med`), `x-count` pagination, and the two-request video-game details flow are preserved. OAuth/cache values stay untrusted (narrowed on read).
- Deno runner-integration tests execute representative GiantBomb (`search`) and IGDB (`search`, exercising the full Twitch token POST + cache write) drivers with canned host responses (no live network). Host/HTTP budgets are unchanged and comfortably accommodate these flows.

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
