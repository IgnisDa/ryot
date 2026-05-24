# TVDB Translation

**Parent Plan:** [Media Translations](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add TVDB translation across its full kind set — movie, show, season, episode, person, and movie
group — mirroring the TMDB slices (tasks 01–03). No new infrastructure.

- Declare `providerInformation` (`source: "tvdb"`, plus `canonicalLanguage`) on the in-scope TVDB
  scripts and update their `details` drivers to use the injected canonical language.
- Add `translate` drivers for tvdb movie, show, season, episode, person, and movie group, with
  fields per the PRD "Translation coverage matrix".
- For seasons/episodes, store and use the parent reference on child properties, as in task 03.

## Acceptance criteria

- [x] All in-scope `tvdb` scripts declare `providerInformation` and use the injected canonical
      language in `details`.
- [x] `translate` drivers exist for tvdb movie, show, season, episode, person, and movie group;
      episodic kinds store and resolve via the parent reference.
- [x] Integration test: a TVDB movie, a TVDB person, and a TVDB episode return merged localized
      fields (`pending` → `ready`).

## Implementation Notes

- `movie.tvdb`, `show.tvdb`, `person.tvdb`, and `movie-group.tvdb` now declare source `tvdb` with
  canonical language `eng`, matching the legacy TVDB default.
- TVDB details drivers read canonical language from script metadata and best-effort merge the
  canonical translation endpoint over the extended payload. Missing canonical translation data falls
  back to the existing extended response.
- TVDB translate drivers use the provider-native `/translations/{language}` endpoints for movies,
  series, seasons, episodes, people, and lists. Missing or unsupported translation lookups return an
  empty overlay so the shared workflow can negative-cache the result.
- `show.tvdb` now stores `parentShowExternalId` on generated show-season and show-episode
  properties. The translate driver requires that parent reference for episodic overlays before using
  TVDB's direct season/episode translation endpoints.
- TVDB image overlays are returned only where TVDB exposes language-tagged artwork on the extended
  record (movies, shows, and seasons). TVDB person, list, and episode translation records expose
  translated text but no language-tagged primary image in the official API schema.
- E2E coverage was added for a TVDB movie, person, and episode. Local verification was limited to
  parse-only sandbox script checks because this machine does not have the required Bun/Deno
  application dependencies.

## User stories addressed

Reference by number from the parent PRD:

- User stories 1, 7, 8, 9 (for TVDB-sourced media)
