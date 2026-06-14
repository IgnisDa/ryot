# Anime and Manga Providers

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Convert the anime and manga source families into SDK TypeScript modules: AniList anime, manga, person, and company; MyAnimeList anime and manga; MangaUpdates manga and person. Use pinned Zod, Day.js, and Cheerio SDK imports, ordinary title-case helper imports where currently required, static manifests, typed host calls, standard provider contracts, and runtime validation of consumed external payloads.

Preserve GraphQL and REST request behavior, HTML description normalization, canonical language and translation behavior, title selection, date handling, status and format normalization, genres, images, suggestions, relationships, pagination, and entity-specific properties. Maintain source-specific helpers within the family and avoid merging unrelated API models merely because the providers share an entity domain.

## Acceptance criteria

- [ ] All eight AniList, MyAnimeList, and MangaUpdates sources in this slice are SDK TypeScript modules
- [ ] Manifests preserve exact slugs, source metadata, canonical languages, host capabilities, and configuration requirements
- [ ] Title-case helper use is replaced by ordinary typed imports and bundled output
- [ ] Zod, Day.js, and Cheerio are imported only through approved SDK entry points
- [ ] GraphQL, REST, and scraped payload fields consumed by drivers are runtime-validated
- [ ] Search, details, translate, title, date, status, format, genre, image, suggestion, and relationship behavior remains consistent
- [ ] Existing AniList, MyAnimeList, and MangaUpdates behavioral tests use typed SDK hosts and continue to pass
- [ ] Compiled Deno coverage includes one GraphQL plus Cheerio provider, one MyAnimeList provider, and one MangaUpdates provider
- [ ] Generated registry and seeding contain all converted providers exactly once
- [ ] Corresponding JavaScript sources and obsolete helper injection paths are removed
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
