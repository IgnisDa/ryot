# iTunes Podcasts and YouTube Music

**Parent Plan:** [Media Translations](./README.md)

**Type:** AFK

**Status:** todo

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

- [ ] `itunes` translates at the podcast and podcast-episode level; episode population stores the
      parent podcast reference used by the `translate` driver.
- [ ] `youtube-music` music, music-group, and person `translate` drivers return localized names.
- [ ] All affected iTunes and YouTube Music scripts declare `providerInformation` and use the
      injected canonical language in `details`.
- [ ] Integration test: a podcast episode returns a localized name/description via its stored parent
      reference (`pending` → `ready`); a YouTube Music item returns a localized name.

## User stories addressed

Reference by number from the parent PRD:

- User story 10
- User story 11
