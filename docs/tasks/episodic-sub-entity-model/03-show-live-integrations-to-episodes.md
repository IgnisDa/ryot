# Show live integrations → episodes

**Parent Plan:** [Episodic Sub-Entity Model](./README.md)

**Type:** AFK

**Status:** done

## What to build

Make live "now watching" events from media-server integrations land on the
correct episode entity, and update de-duplication accordingly.

This slice implements, per the parent PRD:

- The integration sink changes — see *Integration sinks*: the shared
  progress-result builder takes the episode locator instead of positional fields,
  and the resulting event is resolved to an episode entity through the Episode
  Resolver (built in slice 02). The five show sinks (Jellyfin, Emby, Plex, Kodi,
  browser extension) are updated. Sink events lacking a season number cannot be
  resolved and are dropped + logged.
- The progress-policy trigger change — see *Integration progress-policy*: the
  show/podcast positional keys are removed from its sub-item key set; for
  show/podcast, de-duplication keys on the episode entity identity plus
  `consumedOn` and `progressPercent`. The anime/manga sub-item keys are kept
  unchanged.

Slice-specific constraints:

- Depends on the Episode Resolver (slice 02) and the episode event schemas (slice
  01).
- There are no live podcast sinks, so this slice is show-only.
- Do not change the anime/manga de-duplication behavior.

## Acceptance criteria

- [x] Live "now watching S#E#" events from the five show sinks attach to the
      resolved episode entity; events lacking enough coordinates are dropped and
      logged.
- [x] Two progress events for the same episode with the same `consumedOn` and
      `progressPercent` are de-duplicated; anime/manga de-duplication is unchanged.
- [x] The show/podcast positional keys are removed from the progress-policy
      sub-item key set, with anime/manga keys retained.
- [x] Tests pass: progress-resolution E2E for the sink path; de-duplication
      behavior test (see *Testing Decisions*).

## User stories addressed

- User story 15
- User story 16
