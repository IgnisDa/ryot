# Anime and Manga Providers

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Convert the anime and manga source families into SDK TypeScript modules: AniList anime, manga, person, and company; MyAnimeList anime and manga; MangaUpdates manga and person. Use pinned Zod, Day.js, and Cheerio SDK imports, ordinary title-case helper imports where currently required, static manifests, typed host calls, standard provider contracts, and runtime validation of consumed external payloads.

Preserve GraphQL and REST request behavior, HTML description normalization, canonical language and translation behavior, title selection, date handling, status and format normalization, genres, images, suggestions, relationships, pagination, and entity-specific properties. Maintain source-specific helpers within the family and avoid merging unrelated API models merely because the providers share an entity domain.

## Acceptance criteria

- [x] All eight AniList, MyAnimeList, and MangaUpdates sources in this slice are SDK TypeScript modules
- [x] Manifests preserve exact slugs, source metadata, canonical languages, host capabilities, and configuration requirements
- [x] Title-case helper use is replaced by ordinary typed imports and bundled output
- [x] Zod, Day.js, and Cheerio are imported only through approved SDK entry points
- [x] GraphQL, REST, and scraped payload fields consumed by drivers are runtime-validated
- [x] Search, details, translate, title, date, status, format, genre, image, suggestion, and relationship behavior remains consistent
- [x] Existing AniList, MyAnimeList, and MangaUpdates behavioral tests use typed SDK hosts and continue to pass
- [x] Compiled Deno coverage includes one GraphQL plus Cheerio provider, one MyAnimeList provider, and one MangaUpdates provider
- [x] Generated registry and seeding contain all converted providers exactly once
- [x] Corresponding JavaScript sources and obsolete helper injection paths are removed
- [x] Backend and relevant E2E checks and tests pass

## Implementation notes

- Converted all eight providers into format-1 SDK provider modules with static manifests. AniList anime and manga declare `httpCall`/`getUserPreferences` with canonical language `en`; AniList person and company declare `httpCall` only with no canonical language; both MyAnimeList providers declare `httpCall`/`getAppConfigValue`/`getUserPreferences` plus `providers.malClientId`; both MangaUpdates providers declare `httpCall` only. All slugs, display names, and source identifiers match the legacy registrations exactly.
- Created three family helper modules. `providers/anilist-shared.ts` owns the GraphQL POST/error-extraction plumbing (including the legacy quirk that a GraphQL `errors` array with an unreadable message is ignored), title-language normalization, BCP-47 → title-language mapping, requested/fallback title selection, numeric-id validation with per-entity labels, fuzzy publish years, media suggestion collection, image/genre collection, Cheerio `<br>` → newline description cleaning, NSFW preference lookup, and the shared media search and translate drivers. `providers/myanimelist-shared.ts` owns client-id retrieval, the authenticated GET helper, NSFW-gated search with MAL's cursor-based paging estimate, date/NSFW/image/genre/suggestion parsing. `providers/manga-updates-shared.ts` owns GET/POST/optional-GET request helpers, `total_hits` paging, and the nested `image.url.original` extraction.
- Replaced the injected `toTitleCase` fragment with the ordinary typed module `script-helpers/title-case-delimiters.ts`, imported and bundled by the AniList and MyAnimeList media modules. Deleted `title-case-delimiters.sandbox.js` and removed `withDelimiterTitleCaseHelper` from `legacy-sandbox-helpers.ts`; the whitespace-only `title-case.sandbox.js` variant remains for the unmigrated book/audiobook providers.
- Family-specific behavior stays in the modules: AniList anime keeps the airing-schedule merge (schedule nodes plus `nextAiringEpisode`, episode-sorted, unix → ISO via Day.js) and incoming-additive studio group; AniList person keeps the unbounded 25-per-page character/staff pagination, `Voicing (Character)` role naming, and role merging without name upgrades; AniList company keeps un-deduplicated media edges and per-type authoritative groups; MangaUpdates manga keeps the Cheerio-based status-line parsing (`"12 Volumes (Ongoing)"` → volumes 12, status `Ongoing`) and the per-suggestion series lookups that silently skip failed fetches; MangaUpdates person keeps range-checked birthday formatting and `Author`-role series relationships.
- Replaced the eight raw source-text registrations in `registry.ts` with generated registry entries. The registry test now asserts the eight slugs occur exactly once as source-mapped format-1 modules, alongside the existing TMDB/TVDB family checks.
- Rewrote the seven existing behavioral test files against `defineSandboxTestHost`/`runSandboxTestDriver`, preserving every legacy assertion (recommendation groups, credit groups, studio associations, pagination bodies, MAL suggestion ordering, MangaUpdates suggestion fetches), and added property-mapping, NSFW-branching, translation, and status-extraction coverage now that the real Zod/Day.js/Cheerio dependencies replace the old test stand-ins. Added a new `person/manga-updates.test.ts` suite; that provider previously had no direct tests.
- Added two Deno integration tests: the compiled AniList anime module runs `details` end to end (GraphQL request, bundled Cheerio HTML cleaning, bundled title-case helper, Day.js airing schedule), and the compiled MyAnimeList anime and MangaUpdates manga modules run `search` against the local bridge, asserting the MAL client-id config read. No live network access.

## Problems and deviations

- The initial `bun run sandbox:compile` invocation ran past the foreground timeout and its background continuation was killed; rerunning it as a proper background task compiled all 23 built-ins cleanly. No source changes were involved.
- Search items whose payload lacks a usable title are now dropped instead of emitted with an empty-string title, because the provider search output schema requires non-empty titles. Legacy code emitted `titleProperty: { value: "" }` for AniList media/staff missing all title variants, MAL nodes without a string `title`, and MangaUpdates results without a string `hit_title` (its `record.title` fallback was dead code because `hit_title` was coalesced from `""`, never `null`). Real provider payloads always include these fields.
- MangaUpdates details now emits `volumes: null`/`productionStatus: null` when the `status` field is missing instead of omitting the keys (legacy returned `{}` from `extractStatus` and JSON serialization dropped the `undefined` properties). Sibling providers already emit explicit nulls for absent properties.
- Following the TMDB/TVDB family conventions: empty-string host error messages now fall back to descriptive messages (`??` → `||`), title/image strings are trimmed during validation, and non-object JSON payload roots are treated as absent rather than flowing through. The search-title trim also matches what the SDK output schema enforces at runtime.
- Details drivers read the canonical language from the static manifest instead of execution metadata (`metadata.providerInformation.canonicalLanguage`); seeding stores the manifest as the script metadata, so the value is identical. This matches the migrated TMDB/TVDB modules.
- Manifest capabilities are narrowed to what each script actually calls (for example MangaUpdates declares only `httpCall`) instead of the legacy blanket five-capability list applied to every raw built-in, consistent with the TMDB/TVDB family migrations.

## Verification

- `bun run sandbox:compile` in `apps/app-backend`: 23 built-in sandbox modules compiled.
- `bun run test` in `apps/app-backend`: full suite passed, including the rewritten AniList/MyAnimeList/MangaUpdates module suites, the new registry family test, and the two new Deno compiled-module tests.
- `bun turbo --filter=@ryot/app-backend check` passed.
- `bun turbo --filter=@ryot/app-backend build` passed and embedded all 23 generated format-1 modules.
- `RUN_LIVE_PROVIDER_TESTS=0 bun run test 'src/sandbox/sandbox.test.ts'` in `tests`: hermetic E2E suite passed against a real spun-up backend.

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
