# TMDB People and Movie Groups

**Parent Plan:** [Media Translations](./README.md)

**Type:** AFK

**Status:** todo

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

- [ ] `person.tmdb` and `movie-group.tmdb` declare `providerInformation` and use the injected
      canonical language in `details`.
- [ ] Each has a `translate` driver returning localized name/description/image for a given language.
- [ ] Integration test: a TMDB person detail and a TMDB movie-group detail each return merged
      localized fields under a non-canonical preference (`pending` → `ready`), and the overlay is
      shared across users.

## User stories addressed

Reference by number from the parent PRD:

- User story 7
- User story 8
