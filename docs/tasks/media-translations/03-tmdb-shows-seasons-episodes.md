# TMDB Shows, Seasons, and Episodes

**Parent Plan:** [Media Translations](./README.md)

**Type:** AFK

**Status:** todo

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

- [ ] `show.tmdb` population stores the parent show external id on both season and episode entity
      properties.
- [ ] The `show.tmdb` `translate` driver resolves show, season, and episode translations from
      external id + properties + language.
- [ ] `show.tmdb` `details` uses the injected canonical language.
- [ ] Integration test: a show, one of its seasons, and one of its episodes each return localized
      name/description on their own detail read (`pending` → `ready`), with the episode resolved via
      the stored parent reference.

## User stories addressed

Reference by number from the parent PRD:

- User story 9
