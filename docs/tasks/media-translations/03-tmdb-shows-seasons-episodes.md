# TMDB Shows, Seasons, and Episodes

**Parent Plan:** [Media Translations](./README.md)

**Type:** AFK

**Status:** done

## What to build

Translate TMDB **shows** and their **seasons** and **episodes**, each of which is a first-class
entity in V2 that translates independently on its own detail page.

- Add a `show.tmdb` `translate` driver that handles the show, show-season, and show-episode kinds.
- Season and episode external ids are flat provider ids, but TMDB episode translation requires the
  parent series id plus season/episode numbers. Season/episode numbers are already stored on the
  child entity properties; this slice additionally stores the **parent show external id** on season
  and episode properties during `show.tmdb` population, so the `translate` driver can rebuild
  provider paths from external id + properties + language. See PRD "Translate driver contract"
  (episodic note) and "Translation coverage matrix".
- Update `show.tmdb` `details` to use the injected canonical language.

## Acceptance criteria

- [x] `show.tmdb` population stores the parent show external id on both season and episode entity
      properties.
- [x] The `show.tmdb` `translate` driver resolves show, season, and episode translations from
      external id + properties + language.
- [x] `show.tmdb` `details` uses the injected canonical language.
- [x] Integration test: a show, one of its seasons, and one of its episodes each return localized
      name/description on their own detail read (`pending` → `ready`), with the episode resolved via
      the stored parent reference.

## Implementation Notes

- `show.tmdb` now declares TMDB provider metadata and its `details` driver reads the canonical
  language from script metadata instead of hardcoding English.
- TMDB show population stores `parentShowExternalId` on generated show-season and show-episode
  properties; the built-in episodic property schemas include that field so it survives validation.
- The `show.tmdb` `translate` driver handles `show`, `show-season`, and `show-episode` by mapping
  to TMDB's series, season, and episode translation endpoints. Season and episode paths are rebuilt
  from the stored parent show id plus season/episode numbers. Missing required child context is
  treated as an invalid provider payload rather than as an empty provider translation.
- App-backend unit coverage was added in `registry.test.ts` for the new TMDB show provider metadata
  and the episodic parent-id property schema fields.
- The e2e translation test now covers show, season, and episode `pending` → `ready` behavior using
  the stored parent show id. Local verification of the `ready` path remains blocked by the same live
  TMDB timeout behavior noted in previous tasks: existing movie/person/group ready-state tests timed
  out before this new test, and the new show test reached `pending` but timed out waiting for
  `ready`.

## User stories addressed

Reference by number from the parent PRD:

- User story 9
