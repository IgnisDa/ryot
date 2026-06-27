# TVDB Provider Family

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Convert all TVDB providers into SDK TypeScript modules: movie, show, person, company, and movie-group. Compile them through the trusted built-in pipeline and preserve their shared login, token-cache, request, external identifier, translation, and relationship behavior under the parent plan's provider, host, dependency, persistence, and limit contracts.

Create family-local typed helpers for TVDB authentication and requests only where they replace genuine repetition across the five modules. Keep each script's manifest and driver set explicit. Validate consumed API payload fields at runtime and preserve existing failure messages and token expiry behavior. Remove the corresponding JavaScript sources after their generated modules and tests are authoritative.

## Acceptance criteria

- [x] TVDB movie, show, person, company, and movie-group are SDK TypeScript provider modules
- [x] Every manifest declares exact source, canonical language where applicable, host capabilities, and TVDB API-key configuration
- [x] Shared authentication and request logic is typed, tested, and bundled without hidden runtime globals
- [x] Token cache behavior, expiry, login failures, and API failures remain consistent
- [x] Search, details, translate, hierarchy, image, relationship, and external identifier behavior remains consistent for each entity kind
- [x] Consumed TVDB response fields are runtime-validated rather than asserted after JSON parsing
- [x] Existing TVDB tests use SDK test hosts and retain app-owned assertions
- [x] Compiled Deno tests execute representative drivers from all five modules without live network calls
- [x] Generated registry and seeding contain each TVDB provider exactly once
- [x] Legacy TVDB JavaScript sources and obsolete test rewriting are removed
- [x] Backend and relevant E2E checks and tests pass

## Implementation notes

- Converted all five TVDB providers into format-1 SDK provider modules with static manifests. Each declares source `tvdb`, the exact capabilities `httpCall`/`getCachedValue`/`setCachedValue`/`getAppConfigValue`, and `providers.tvdbApiKey`; movie, show, person, and movie-group declare canonical language `en`, company declares none, matching the legacy registrations.
- Created the family helper `providers/tvdb-shared.ts` owning the duplicated legacy plumbing: API-key retrieval, login with the `tvdb_access_token` cache key, 23-hour TTL, `Bearer` prefixing and tolerated cache-write failures, `tvdbGet`/`tvdbGetOptional` with 400/404 missing handling, the BCP-47 → TVDB language map, primary-translation-record selection, localized artwork, image/genre collection, the movie/show people and company collectors with role merging, and the shared search driver (offset/limit paging, `tvdb_id` identifiers, per-provider name and image key chains).
- Show keeps a local `tvdb-details.ts` preserving season dedup by number (first id wins), sequential season batches of five, official-season filtering and sorting, and the episode/season child-entity property shapes. Movie preserves official-list movie-group relationships, runtime gating, and slug-only source URLs. Person preserves its own credit collection (no 20-item cap, `Actor` default role, append-only role merging without name upgrades, `www.` source URLs). Movie-group preserves the legacy payload-unwrap quirk, the pre-drop `parts` count, string-only member ids, and order-slot gaps. Company preserves alias/primaryImage/country mapping and `primaryImage` search-image fallback.
- Replaced the five raw source-text registrations in `registry.ts` with generated registry entries and deleted the legacy `.js` sources. Registry coverage asserts the five TVDB slugs occur exactly once as source-mapped format-1 modules; the compile step enforces slug uniqueness during generation.
- Added per-module driver tests using `defineSandboxTestHost`/`runSandboxTestDriver` plus a central `tvdb-shared.test.ts` for token cache reuse, login, expiry TTL, login/API/config failures, missing-endpoint handling, and language mapping. TVDB had no pre-existing direct test files, so this coverage is new rather than migrated.
- Added two Deno integration tests: the compiled show module runs search through the complete cache-miss → login → cache-write token flow, and the compiled movie, person, and company modules run search while movie-group runs translate, all against the local bridge with no live network.

## Problems and deviations

- The only behavioral divergences from the legacy sources are on malformed payloads TVDB never returns, introduced deliberately by the mandated runtime validation and matching TMDB family conventions: non-object JSON bodies now fail with "TVDB returned an invalid response object" instead of flowing through, collected image URLs and tokens are trimmed (and deduplicated post-trim), non-object character entries are dropped instead of synthesizing "Loading…"/"Cast" unlinked creators, empty-string host errors fall back to descriptive messages (`??` → `||`), and the search total-items fallback counts validated records. Five independent adversarial reviewers compared each module line-by-line against the legacy sources and confirmed behavior is identical for all well-formed TVDB responses.
- The acceptance item about existing TVDB tests could not be satisfied by migration because no direct TVDB tests existed; equivalent SDK-test-host suites were written instead. The generic legacy provider evaluator remains in place for the still-unmigrated provider families, as already noted in Task 09.
- Minor fixes after conversion review: search driver tests needed explicit `page`/`pageSize` inputs to satisfy the SDK input type, the person translate driver needed exporting for its test, and the shared API-error message construction was reworked once to satisfy type-aware linting without stringifying unknown values implicitly.

## Verification

- `bun run sandbox:compile` in `apps/app-backend`: 15 built-in sandbox modules compiled.
- `bun run test` in `apps/app-backend`: 152 files and 927 tests passed, including the new TVDB module, shared-helper, and registry suites.
- Deno runner integration file: 14 tests passed, including the two new TVDB compiled-module tests.
- `bun turbo --filter=@ryot/app-backend check` passed without warnings.
- `bun turbo --filter=@ryot/app-backend build` passed and embedded all 15 generated format-1 modules.
- `bun turbo --filter=@ryot/tests check` passed.
- `RUN_LIVE_PROVIDER_TESTS=0 bun run test 'src/sandbox/sandbox.test.ts'` in `tests`: 1 hermetic E2E test passed against a real spun-up backend.

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
