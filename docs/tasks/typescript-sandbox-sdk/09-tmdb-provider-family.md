# TMDB Provider Family

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Complete the TMDB family after the TMDB Show tracer in Task 06. Convert the movie, person, company, and movie-group providers into normal SDK TypeScript modules compiled through the trusted built-in pipeline. Use the shared provider contracts, exact SDK dependency imports, static manifests, typed host calls, runtime schemas for consumed TMDB payloads, and the generated registry described in the parent plan.

Preserve access-token retrieval, user NSFW preferences, image and genre normalization, external identifier handling, suggestions, canonical language, translation behavior, child and related entities, pagination, resolution, and downstream metadata-lookup behavior. Reuse family-local typed helpers where they reduce real duplication without creating a new cross-provider abstraction. Remove the converted JavaScript sources and any now-unused TMDB-specific source-string test support.

## Acceptance criteria

- [x] TMDB movie, person, company, and movie-group are SDK TypeScript provider modules
- [x] All four manifests declare exact names, slugs, source, canonical language where applicable, capabilities, and required access-token configuration
- [x] Driver input and output use SDK provider contracts and consumed external payload fields are runtime-validated
- [x] Existing search, details, resolve, translate, suggestion, image, relationship, and pagination behavior is preserved per provider
- [x] Sensitive access-token retrieval remains available only under built-in policy
- [x] Metadata lookup continues to execute compiled TMDB movie and show search drivers successfully
- [x] Existing TMDB direct tests use typed SDK host stubs and retain their behavioral assertions
- [x] Compiled Deno tests cover representative movie, person, company, and group drivers without live network calls
- [x] Generated registry and seeding include all five TMDB providers exactly once, including the previously converted Show provider
- [x] Legacy TMDB JavaScript sources and family-specific evaluation helpers are removed when no longer referenced
- [x] Backend and relevant E2E checks and tests pass

## Implementation notes

- Converted movie, person, company, and movie-group into format-1 SDK provider modules with static manifests, standard provider drivers, exact host capabilities, and built-in access-token configuration. Movie retains its custom typed trending driver alongside search, details, resolve, and translate.
- Moved the TMDB request and normalization helper from the Show directory to the provider-family root. The helper now exposes capability-minimal host types and shared runtime validation for JSON objects, strings, numbers, images, genres, suggestions, translation candidates, and paginated trending responses.
- Preserved movie recommendations, people/company/group relationships, person movie/show credits, company discover pagination, collection ordering and suffix normalization, localized image overlays, canonical language, NSFW search preferences, and external IMDb resolution.
- Replaced all four raw source registrations with generated registry entries. Registry coverage verifies that movie, show, person, company, and movie-group occur exactly once and all use source-mapped compiled format 1.
- Migrated the existing direct tests to `defineSandboxTestHost` and `runSandboxTestDriver`, added movie-group details and translation coverage, updated metadata-lookup fixtures so both movie and show use compiled manifests, and executed representative search drivers from all four new modules in Deno.

## Problems and deviations

- The Show tracer's shared helper hard-coded `show.tmdb` suggestions and `/trending/tv/day`, and its host type required user preferences for every caller. The helper was relocated and parameterized so Movie can safely reuse it while Company and Movie Group retain smaller exact capability sets.
- The generic legacy provider evaluator and import rewriter were not removed because non-TMDB provider tests still depend on them. All TMDB tests and registry imports no longer use that path, so removing it is deferred until the remaining provider-family tasks complete.
- Initial compilation exposed an incorrectly parsed person alternate-name array, and the first check rejected one nested ternary. Both were corrected during implementation. No blocker remained and no product behavior was intentionally changed.

## Verification

- `bun run sandbox:compile` in `apps/app-backend`: 10 built-in sandbox modules compiled.
- Focused TMDB provider, registry, and metadata-lookup run: 7 files and 23 tests passed.
- `bun run test -- 'src/lib/infrastructure/sandbox-runtime/runner-integration.test.ts'` in `apps/app-backend`: 12 Deno integration tests passed.
- `bun run test` in `apps/app-backend`: 146 files and 883 tests passed.
- `bun turbo --filter=@ryot/app-backend check` passed without warnings.
- `bun turbo --filter=@ryot/app-backend build` passed and embedded all 10 generated format-1 modules.
- `bun turbo --filter=@ryot/tests check` passed, including dependency package checks.
- `RUN_LIVE_PROVIDER_TESTS=0 bun run test 'src/sandbox/sandbox.test.ts'` in `tests`: 1 hermetic E2E test passed.

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
