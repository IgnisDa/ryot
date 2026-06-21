# Audiobook and Podcast Providers

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Convert Audible audiobook, person, and audiobook-group; iTunes podcast; and ListenNotes podcast into SDK TypeScript modules. Use approved Zod, Day.js, and Cheerio imports, typed host calls, static manifests, standard provider outputs, runtime external-payload validation, and the trusted built-in compiler.

Preserve Audible marketplace scraping, recommendations, authors and narrators, grouping, images, duration, release metadata, and title-case behavior. Preserve iTunes search, lookup, translation, feed metadata, dates, and pagination behavior. Preserve ListenNotes authentication, genre caching, podcast details, dates, images, and error behavior. Keep all hermetic tests offline.

## Acceptance criteria

- [ ] All five Audible, iTunes, and ListenNotes sources in this slice are SDK TypeScript modules
- [ ] Manifests preserve source metadata, canonical language where applicable, host capabilities, and required API configuration
- [ ] Cheerio, Day.js, Zod, and title-case helpers use approved typed imports
- [ ] Scraped HTML and consumed REST payload fields are runtime-validated at the script boundary
- [ ] Audible search, details, recommendations, contributors, groups, duration, dates, images, and marketplaces remain consistent
- [ ] iTunes search, details, translate, feed, dates, and pagination remain consistent
- [ ] ListenNotes authentication, genre cache, search, details, dates, images, and failures remain consistent
- [ ] Existing provider tests use typed SDK hosts and retain behavioral assertions
- [ ] Compiled Deno tests cover one scraping driver and both podcast providers without live network calls
- [ ] Generated registry and seeding contain all converted providers exactly once
- [ ] Corresponding JavaScript sources and obsolete helper injection are removed
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
