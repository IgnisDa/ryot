# TMDB Provider Family

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Complete the TMDB family after the TMDB Show tracer in Task 06. Convert the movie, person, company, and movie-group providers into normal SDK TypeScript modules compiled through the trusted built-in pipeline. Use the shared provider contracts, exact SDK dependency imports, static manifests, typed host calls, runtime schemas for consumed TMDB payloads, and the generated registry described in the parent plan.

Preserve access-token retrieval, user NSFW preferences, image and genre normalization, external identifier handling, suggestions, canonical language, translation behavior, child and related entities, pagination, resolution, and downstream metadata-lookup behavior. Reuse family-local typed helpers where they reduce real duplication without creating a new cross-provider abstraction. Remove the converted JavaScript sources and any now-unused TMDB-specific source-string test support.

## Acceptance criteria

- [ ] TMDB movie, person, company, and movie-group are SDK TypeScript provider modules
- [ ] All four manifests declare exact names, slugs, source, canonical language where applicable, capabilities, and required access-token configuration
- [ ] Driver input and output use SDK provider contracts and consumed external payload fields are runtime-validated
- [ ] Existing search, details, resolve, translate, suggestion, image, relationship, and pagination behavior is preserved per provider
- [ ] Sensitive access-token retrieval remains available only under built-in policy
- [ ] Metadata lookup continues to execute compiled TMDB movie and show search drivers successfully
- [ ] Existing TMDB direct tests use typed SDK host stubs and retain their behavioral assertions
- [ ] Compiled Deno tests cover representative movie, person, company, and group drivers without live network calls
- [ ] Generated registry and seeding include all five TMDB providers exactly once, including the previously converted Show provider
- [ ] Legacy TMDB JavaScript sources and family-specific evaluation helpers are removed when no longer referenced
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
