# Anilist Translation and Canonical `details` Refactor

**Parent Plan:** [Media Translations](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add Anilist anime/manga translation and fix the bake-at-populate behavior in which Anilist
populated a per-user title into the globally shared entity.

- Refactor Anilist `details` to populate the **english** canonical title and to stop reading the
  user's language preference at population time (see PRD "Anilist and TMDB population refactor").
- Declare `providerInformation { source: "anilist", canonicalLanguage: "english" }` on the Anilist
  anime and manga scripts.
- Add an `anilist` `translate` driver that returns the title for the requested mode
  (romaji / native / english / user_preferred) as a name-only overlay (per the PRD "Translation
  coverage matrix"). `user_preferred` is only ever an overlay, never canonical, because it is
  viewer-dependent.

Note (PRD "Out of Scope" / "Further Notes"): there is no auto-invalidation, so Anilist entities
already populated with a per-user title before this change keep that title until they are
re-populated. This is accepted.

## Acceptance criteria

- [ ] Anilist `details` no longer reads the user's language preference and populates the english
      canonical title.
- [ ] Anilist anime and manga declare `providerInformation` with `canonicalLanguage: "english"`.
- [ ] The `anilist` `translate` driver returns the title for a requested mode; `user_preferred` is
      served only as an overlay.
- [ ] Integration test: an Anilist title viewed under a non-english title mode returns a localized
      name overlay (`pending` → `ready`); `details` output for the same entity is independent of the
      requesting user.

## User stories addressed

Reference by number from the parent PRD:

- User story 12
