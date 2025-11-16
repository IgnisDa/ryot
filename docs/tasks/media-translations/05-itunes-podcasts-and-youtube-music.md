# iTunes Podcasts and YouTube Music

**Parent Plan:** [Media Translations](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add translation coverage for two more providers, reusing the spine.

- **iTunes:** translate podcasts and podcast episodes (episode-level), fields name/description.
  Episodes are first-class entities; store the **parent podcast reference** on episode properties
  during population (mirroring the show/episode approach in task 03) so the `translate` driver can
  address the provider.
- **YouTube Music:** translate music, music groups, and persons — name only (per the PRD
  "Translation coverage matrix").

For both providers, declare `providerInformation` (`source` + `canonicalLanguage`) on the relevant
scripts and update their `details` drivers to use the injected canonical language.

## Acceptance criteria

- [x] `itunes` translates at the podcast and podcast-episode level; episode population stores the
      parent podcast reference used by the `translate` driver.
- [x] `youtube-music` music, music-group, and person `translate` drivers return localized names.
- [x] All affected iTunes and YouTube Music scripts declare `providerInformation` and use the
      injected canonical language in `details`.
- [x] Integration test: a podcast episode returns a localized name/description via its stored parent
      reference (`pending` → `ready`); a YouTube Music item returns a localized name.

## Implementation Notes

- `podcast.itunes` now declares source `itunes` with canonical language `en_us`; its `details`
  driver reads canonical language from script metadata, stores `parentPodcastExternalId` on episode
  properties, and implements `translate` for podcast and podcast-episode name/description overlays.
- The iTunes episode translate path uses the stored parent podcast id. Older episode rows populated
  before this task need re-population to gain `parentPodcastExternalId`; without that context the
  workflow remains re-executable rather than writing a false negative-cache row.
- `music.youtube-music`, `music-group.youtube-music`, and `person.youtube-music` now declare source
  `youtube-music` with canonical language `en`; their `details` drivers create language-scoped
  `youtubei.js` sessions and their `translate` drivers return name-only overlays.
- App-backend unit coverage was added for the new provider metadata and the podcast episode parent
  id property schema.
- The e2e translation suite now covers an iTunes podcast episode `pending` → `ready` overlay via the
  stored parent podcast id, and a YouTube Music music item `pending` → `ready` name overlay.
- Verified with targeted app-backend unit tests, `bun turbo --filter=@ryot/app-backend check`, the
  tests package check, and targeted iTunes/YouTube Music e2e tests.

## User stories addressed

Reference by number from the parent PRD:

- User story 10
- User story 11
