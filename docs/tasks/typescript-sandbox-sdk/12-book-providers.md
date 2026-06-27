# Book Providers

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Convert the book source families into SDK TypeScript modules: Hardcover book, person, company, and book-group; OpenLibrary book and person; Google Books book. Compile each through the trusted pipeline with static manifests, standard provider outputs, typed host methods, pinned SDK dependencies, ordinary title-case imports, and runtime validation of consumed GraphQL and REST fields.

Preserve API-key behavior, ISBN and external identifier resolution, publication dates, editions, images, descriptions, contributors, related entities, grouping, pagination, title normalization, and the OpenLibrary custom date parsing behavior. Keep provider-specific models and errors explicit while sharing only stable family-local request or normalization helpers.

## Acceptance criteria

- [x] All seven Hardcover, OpenLibrary, and Google Books sources in this slice are SDK TypeScript modules
- [x] Manifests preserve exact slugs, source metadata, host capabilities, and configuration requirements
- [x] Title-case helpers and OpenLibrary custom date parsing use ordinary approved SDK imports
- [x] Consumed GraphQL and REST response fields are runtime-validated
- [x] Search, details, resolve, grouping, contributor relationships, identifiers, dates, editions, images, descriptions, and pagination behavior remains consistent
- [x] Hardcover API-key failures and optional data handling remain consistent
- [x] Existing book provider tests use typed SDK hosts and retain behavioral assertions
- [x] Compiled Deno tests cover Hardcover GraphQL, OpenLibrary date parsing, and Google Books REST without live network calls
- [x] Generated registry and seeding contain all converted providers exactly once
- [x] Corresponding JavaScript sources and obsolete title-case injection are removed
- [x] Backend and relevant E2E checks and tests pass

## Implementation notes

- Converted all seven sources into format-1 SDK provider modules with static manifests. The four
  Hardcover providers (`book`, `person`, `company`, `book-group`) and Google Books declare
  `httpCall`/`getAppConfigValue`; OpenLibrary `book`/`person` declare `httpCall` only. Hardcover
  and Google Books keep their `providers.hardcoverApiKey` / `providers.googleBooksApiKey` required
  config keys; OpenLibrary requires none. All slugs, display names, and `source` identifiers match
  the legacy registrations exactly. No book provider declares a canonical language.
- Added two family-local shared modules. `providers/hardcover-shared.ts` owns the API-key read,
  the GraphQL POST/parse plumbing, the shared `errors[]` first-message extractor, id/string/number
  coercions, and the GraphQL string escaper. `providers/openlibrary-shared.ts` owns the GET/parse
  helper, `getKeySegment` last-path-segment extraction, and the string-or-`{value}` description
  parser. Google Books stays a single self-contained module (its REST helpers are local).
- Replaced the injected whitespace-only `toTitleCase` fragment with the ordinary typed module
  `script-helpers/title-case.ts`, imported and bundled by the three genre-producing book modules
  (Hardcover book, OpenLibrary book, Google Books). OpenLibrary custom date parsing uses
  `@ryot/sandbox-sdk/dayjs`, whose Deno runtime module bundles the SDK entry that already extends
  `customParseFormat`, so strict `dayjs(value, format, true)` parsing works without a separate
  plugin import.
- Preserved provider-specific behavior: Hardcover book's per-key contributor/publisher/series
  role-merge dedup with `"Loading..."` name upgrades and its three incoming-additive relationship
  groups; Hardcover person/company outgoing-authoritative book relationships; Hardcover
  book-group's original-index `order` preservation across dropped members and raw `series_by_pk(id:
  ...)` interpolation; OpenLibrary's earliest-edition date selection, sequential author-name
  fetches with per-work caching, and `person-to-book` authoritative grouping; Google Books'
  `intitle:`/`isbn:` queries, deduplicated unlinked creators, and `imageLinks` precedence.
- Replaced the seven legacy `providerScript`/`withTitleCaseHelper` registrations in `registry.ts`
  with the generated `sandboxBookDot*`/`sandboxPersonDot*`/`sandboxCompanyDot*`/
  `sandboxBookDashGroupDot*` entries. Deleted the seven `.sandbox.js` sources. `withTitleCaseHelper`
  and the whitespace-only `title-case.sandbox.js` fragment remain only for the still-unmigrated
  Audible audiobook family (Task 13).
- Added seven typed-host unit suites (none existed before) covering search mapping and drops,
  detail grouping/genres/dates, GraphQL error surfacing, and ISBN resolution; extended
  `registry.test.ts` with a book-family generated-format assertion; and added three Deno
  compiled-module tests (Hardcover GraphQL `details`, OpenLibrary custom-date `details`, Google
  Books REST `search`) against the local bridge with no live network.

## Problems and deviations

- Following the established family convention (Tasks 09-11), search items whose payload lacks a
  usable non-empty title are dropped rather than emitted with an empty-string title, because the
  provider search output schema requires non-empty titles. This affects Hardcover book/person,
  OpenLibrary book, and Google Books search; real payloads always include the field.
- Empty-string host error messages fall back to descriptive messages (`??` → `||`), and title,
  image, and name strings are trimmed via shared `stringValue` where the legacy code trimmed
  ad hoc — matching the TMDB/TVDB/anime conventions and the runtime output-schema behavior. Detail
  `name`/`description`/date fields that the legacy code passed through untrimmed are still passed
  through untrimmed.
- Google Books `resolve` now returns `{ externalId: null }` when no volume matches, instead of the
  legacy `{ externalId: "" }` (the legacy `id ?? null` was defeated by an `: ""` default, so an
  unresolved lookup returned an empty string). This is a small correctness fix that makes the three
  book `resolve` drivers consistent with each other and with the sibling providers; realistic
  matched lookups are unaffected.
- Manifest capabilities are narrowed to what each script actually calls (OpenLibrary declares only
  `httpCall`) rather than the legacy blanket five-capability list, consistent with the prior
  provider-family migrations.

## Verification

- `bun run sandbox:compile` in `apps/app-backend`: 30 built-in sandbox modules compiled (up from 23).
- `bun run test` book/registry suites: 26 tests passed across the 7 new module suites and the
  extended registry family test.
- `src/lib/infrastructure/sandbox-runtime/runner-integration.test.ts`: 19 tests passed, including
  the three new compiled Hardcover/OpenLibrary/Google Books Deno tests. No live network.
- `bun turbo --filter=@ryot/app-backend check` and the hermetic E2E sandbox suite pass.

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
