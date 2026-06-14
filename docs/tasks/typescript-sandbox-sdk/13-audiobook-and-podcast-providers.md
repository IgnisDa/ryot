# Audiobook and Podcast Providers

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Convert Audible audiobook, person, and audiobook-group; iTunes podcast; and ListenNotes podcast into SDK TypeScript modules. Use approved Zod, Day.js, and Cheerio imports, typed host calls, static manifests, standard provider outputs, runtime external-payload validation, and the trusted built-in compiler.

Preserve Audible marketplace scraping, recommendations, authors and narrators, grouping, images, duration, release metadata, and title-case behavior. Preserve iTunes search, lookup, translation, feed metadata, dates, and pagination behavior. Preserve ListenNotes authentication, genre caching, podcast details, dates, images, and error behavior. Keep all hermetic tests offline.

## Acceptance criteria

- [x] All five Audible, iTunes, and ListenNotes sources in this slice are SDK TypeScript modules
- [x] Manifests preserve source metadata, canonical language where applicable, host capabilities, and required API configuration
- [x] Cheerio, Day.js, Zod, and title-case helpers use approved typed imports
- [x] Scraped HTML and consumed REST payload fields are runtime-validated at the script boundary
- [x] Audible search, details, recommendations, contributors, groups, duration, dates, images, and marketplaces remain consistent
- [x] iTunes search, details, translate, feed, dates, and pagination remain consistent
- [x] ListenNotes authentication, genre cache, search, details, dates, images, and failures remain consistent
- [x] Existing provider tests use typed SDK hosts and retain behavioral assertions
- [x] Compiled Deno tests cover one scraping driver and both podcast providers without live network calls
- [x] Generated registry and seeding contain all converted providers exactly once
- [x] Corresponding JavaScript sources and obsolete helper injection are removed
- [x] Backend and relevant E2E checks and tests pass

## Implementation notes

- Converted `audiobook.audible`, `person.audible`, `audiobook-group.audible`, `podcast.itunes`, and `podcast.listennotes` to SDK TypeScript modules. Audible logic shared across the three variants lives in `providers/audible-shared.ts` (narrowing helpers, `audibleFetchJson`, and the dayjs/cheerio date + HTML helpers). The two podcasts share nothing, so each keeps its own inline REST-boundary narrowing helpers.
- Capabilities: Audible and iTunes use `["httpCall"]` only; ListenNotes uses `["httpCall", "getAppConfigValue", "getCachedValue", "setCachedValue"]` (API-key config + genre cache). iTunes carries `canonicalLanguage: "en"`; iTunes `details` now reads the canonical language directly from `manifest.providerInformation.canonicalLanguage` instead of injected metadata.
- Cheerio (`@ryot/sandbox-sdk/cheerio`) and Day.js (`@ryot/sandbox-sdk/dayjs`) use approved typed SDK imports; the audiobook module imports `toTitleCase` from the TypeScript `script-helpers/title-case`.
- The legacy `withTitleCaseHelper` injection, `legacy-sandbox-helpers.ts`, and the now-unused `script-helpers/title-case.sandbox.js` were removed; the registry consumes the generated format-1 entries.
- ListenNotes's legacy top-level `suggestions` field was remapped into an `outgoing`/`authoritative` `media-suggestion` related-entity group (recommendation thumbnails dropped), because the strict `providerDetailsResultSchema` rejects `suggestions` — matching how Audible/TMDB expose suggestions.
- Deno runner-integration tests cover Audible `details` (cheerio HTML description cleaning + related entities) and both podcast providers' `search` drivers, all with canned host responses (no live network).

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
