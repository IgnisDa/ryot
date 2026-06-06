# TVDB Translation

**Parent Plan:** [Media Translations](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add TVDB translation across its full kind set — movie, show, season, episode, person, and movie
group — mirroring the TMDB slices (tasks 01–03). No new infrastructure.

- Declare `providerInformation` (`source: "tvdb"`, plus `canonicalLanguage`) on the in-scope TVDB
  scripts and update their `details` drivers to use the injected canonical language.
- Add `translate` drivers for tvdb movie, show, season, episode, person, and movie group, with
  fields per the PRD "Translation coverage matrix".
- For seasons/episodes, store and use the parent reference on child properties, as in task 03.

## Acceptance criteria

- [ ] All in-scope `tvdb` scripts declare `providerInformation` and use the injected canonical
      language in `details`.
- [ ] `translate` drivers exist for tvdb movie, show, season, episode, person, and movie group;
      episodic kinds store and resolve via the parent reference.
- [ ] Integration test: a TVDB movie, a TVDB person, and a TVDB episode return merged localized
      fields (`pending` → `ready`).

## User stories addressed

Reference by number from the parent PRD:

- User stories 1, 7, 8, 9 (for TVDB-sourced media)
