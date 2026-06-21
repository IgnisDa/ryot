# TVDB Provider Family

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Convert all TVDB providers into SDK TypeScript modules: movie, show, person, company, and movie-group. Compile them through the trusted built-in pipeline and preserve their shared login, token-cache, request, external identifier, translation, and relationship behavior under the parent plan's provider, host, dependency, persistence, and limit contracts.

Create family-local typed helpers for TVDB authentication and requests only where they replace genuine repetition across the five modules. Keep each script's manifest and driver set explicit. Validate consumed API payload fields at runtime and preserve existing failure messages and token expiry behavior. Remove the corresponding JavaScript sources after their generated modules and tests are authoritative.

## Acceptance criteria

- [ ] TVDB movie, show, person, company, and movie-group are SDK TypeScript provider modules
- [ ] Every manifest declares exact source, canonical language where applicable, host capabilities, and TVDB API-key configuration
- [ ] Shared authentication and request logic is typed, tested, and bundled without hidden runtime globals
- [ ] Token cache behavior, expiry, login failures, and API failures remain consistent
- [ ] Search, details, translate, hierarchy, image, relationship, and external identifier behavior remains consistent for each entity kind
- [ ] Consumed TVDB response fields are runtime-validated rather than asserted after JSON parsing
- [ ] Existing TVDB tests use SDK test hosts and retain app-owned assertions
- [ ] Compiled Deno tests execute representative drivers from all five modules without live network calls
- [ ] Generated registry and seeding contain each TVDB provider exactly once
- [ ] Legacy TVDB JavaScript sources and obsolete test rewriting are removed
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
