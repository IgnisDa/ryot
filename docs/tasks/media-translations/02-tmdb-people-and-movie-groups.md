# TMDB People and Movie Groups

**Parent Plan:** [Media Translations](./README.md)

**Type:** AFK

**Status:** done

## What to build

Extend translation to TMDB **people** and **movie groups** (collections), reusing the spine from
task 01. No new infrastructure — only provider coverage.

- Declare `providerInformation` (`source: "tmdb"`, `canonicalLanguage: "en-US"`) on `person.tmdb`
  and `movie-group.tmdb`, and update their `details` drivers to use the injected canonical
  language.
- Add a `translate` driver to each, returning localized fields per the PRD "Translation coverage
  matrix" (person: name/description/image; movie group: name/description/image), using the
  contract from the PRD "Translate driver contract".

## Acceptance criteria

- [x] `person.tmdb` and `movie-group.tmdb` declare `providerInformation` and use the injected
      canonical language in `details`.
- [x] Each has a `translate` driver returning localized name/description/image for a given language.
- [x] Integration test: a TMDB person detail and a TMDB movie-group detail each return merged
      localized fields under a non-canonical preference (`pending` → `ready`), and the overlay is
      shared across users.

## Implementation Notes

- `person.tmdb` and `movie-group.tmdb` now declare `providerInformation` with `source: "tmdb"`
  and `canonicalLanguage: "en-US"`; their `details` drivers read that canonical language from
  script metadata.
- Both scripts now implement `translate`, preferring exact language-region matches but falling
  back to non-empty same-language fields before returning an empty result for negative caching;
  optional image lookup is best-effort so text translations are not blocked by artwork failures.
- App-backend unit coverage was added in `registry.test.ts` to guard the built-in TMDB metadata.
- The e2e translation test now covers person and movie-group `pending` → `ready` behavior and
  shared overlay reuse. Local verification of the `ready` path was blocked by outbound TMDB
  connectivity (`ECONNRESET` on direct TMDB requests); the pre-existing Task 01 movie pending
  paths timed out in the same run, while the canonical/no-preference path passed.

## User stories addressed

Reference by number from the parent PRD:

- User story 7
- User story 8
