# Game Providers

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Convert GiantBomb video-game, person, company, and video-game-group plus IGDB video-game, company, and video-game-group into seven SDK TypeScript provider modules. Use typed manifests, standard outputs, runtime validation, approved Day.js and Zod imports, typed HTTP/config/cache hosts, and trusted compilation.

Preserve GiantBomb API-key handling, request headers, pagination, descriptions, images, releases, people, companies, franchises/groups, and errors. Preserve IGDB Twitch OAuth, token cache and expiry, query-body generation, dates, images, companies, collections/groups, related entities, and errors. Keep authentication and request helpers family-local and ensure execution budgets accommodate current legitimate request counts.

## Acceptance criteria

- [ ] All seven GiantBomb and IGDB sources are SDK TypeScript modules
- [ ] Manifests preserve source metadata, exact capabilities, and GiantBomb/Twitch configuration requirements
- [ ] GiantBomb search, details, people, companies, groups, pagination, descriptions, images, and failures remain consistent
- [ ] IGDB OAuth, token caching, query generation, dates, images, companies, groups, relationships, and failures remain consistent
- [ ] Consumed REST payload fields are runtime-validated and OAuth/cache values remain untrusted until parsed
- [ ] Shared family helpers do not leak credentials or broaden capabilities
- [ ] Existing GiantBomb and IGDB tests use typed SDK hosts and retain behavioral assertions
- [ ] Compiled Deno tests cover representative GiantBomb and IGDB drivers without live network calls
- [ ] Host and HTTP call budgets permit expected provider flows while still enforcing Task 05 limits
- [ ] Generated registry and seeding contain all seven providers exactly once
- [ ] Corresponding JavaScript sources are removed
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
