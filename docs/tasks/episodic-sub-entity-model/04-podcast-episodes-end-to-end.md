# Podcast episodes end-to-end

**Parent Plan:** [Episodic Sub-Entity Model](./README.md)

**Type:** AFK

**Status:** todo

## What to build

The full podcast vertical, reusing the Child-Entity Tree Processor (slice 01) and
the Episode Resolver (slice 02). Podcasts are a single-level hierarchy
(podcast → episode), so this is simpler than shows.

This slice implements, per the parent PRD:

- The `podcast-episode` builtin entity schema and the `podcast-to-podcast-episode`
  relationship schema, structural like the show sub-entities — see *New builtin
  entity schemas* / *New builtin relationship schemas*.
- The podcast "details" sandbox scripts emitting the episode child tree instead of
  the nested episodes array — see *Sandbox provider output shape*. Population
  creates `podcast-episode` entities + relationship rows (idempotent, keyed on the
  provider-native episode id).
- Removal of the episodes array from the podcast properties, retaining the
  `totalEpisodes` count — see *Modified parent schemas*.
- The event-model flip for podcasts — see *Event-model changes*: `podcast` loses
  `progress`; `podcast-episode` gains `progress` + `complete` (auto-complete at
  100% via the trigger reworked in slice 01).
- The `resolvePodcastEpisode` resolver path and the Audiobookshelf podcast import
  emitting the episode locator — see *Module: Episode Resolver*, *Import pipeline
  and adapters*, and *Identity, idempotency, and resolution*. Podcast resolution
  is **best-effort by episode number with drop-on-miss**, because provider episode
  numbering is derived and unstable upstream — see *Out of Scope* (hardened
  podcast matching is excluded).

Slice-specific constraints:

- Reuses the processor and resolver from earlier slices; only the podcast-specific
  schemas, scripts, adapter, and resolver path are new here.
- There are no live podcast sinks, so only the import path applies.

## Acceptance criteria

- [ ] `podcast-episode` entity schema and `podcast-to-podcast-episode`
      relationship schema are registered as structural builtins.
- [ ] Populating a podcast creates one `podcast-episode` entity per episode (keyed
      on the provider-native id) with relationship rows; re-populating creates no
      duplicates.
- [ ] The podcast properties no longer carry the episodes array; the
      `totalEpisodes` count is retained.
- [ ] `podcast` no longer exposes `progress`; `podcast-episode` exposes
      `progress` + `complete`, and auto-completes at 100%.
- [ ] The Audiobookshelf podcast import resolves episodes by number; unresolved
      episodes are dropped and logged.
- [ ] A single query returns a podcast with its episodes nested, ordered by
      `episodeNumber`, with per-episode progress existence.
- [ ] Tests pass: podcast nested-include read; podcast progress-resolution
      (see *Testing Decisions*).

## User stories addressed

- User story 10
- User story 11
- User story 17
