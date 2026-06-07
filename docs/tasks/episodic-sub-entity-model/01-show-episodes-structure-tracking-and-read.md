# Show episodes: structure, tracking & read

**Parent Plan:** [Episodic Sub-Entity Model](./README.md)

**Type:** AFK

**Status:** todo

## What to build

The foundational vertical slice that flips **shows** to the episode model
end-to-end through the core (non-import) path: a show can be populated into
season/episode entities, read back as a nested tree, and tracked at the episode
level with completion derived for the parent. Importers, live sinks, and podcasts
are explicitly out of this slice.

This slice implements, per the parent PRD:

- The `show-season` and `show-episode` builtin entity schemas, and the
  `show-to-show-season` and `show-season-to-show-episode` relationship schemas —
  see *New builtin entity schemas* and *New builtin relationship schemas*. They
  are **structural** (no "media" tracker link, not added to the curated browse
  views) — see *Structural sub-entities* note under *New builtin entity schemas*.
- The **Child-Entity Tree Processor** deep module — see *Module: Child-Entity Tree
  Processor*. This slice is its first and (for now) only consumer.
- The show "details" sandbox script emitting the child-entity tree instead of the
  nested seasons blob — see *Sandbox provider output shape*. Includes the
  name-fallback and image rules.
- Removal of the nested seasons array from the show properties and addition of the
  denormalized `totalSeasons`/`totalEpisodes` counts — see *Modified parent
  schemas*. Also delete the dead Effect-`Schema` struct definitions for show
  season/episode properties.
- The event-model flip for shows — see *Event-model changes*: `show` loses
  `progress`; `show-episode` gains `progress` + `complete`; `show-season` gains
  `complete`. Positional fields removed from the show progress/review property
  builders.
- The **auto-complete trigger rework** — see *Auto-complete trigger rework*:
  an episode auto-completes at 100%; the show/podcast blob-coverage branches are
  removed; **anime/manga branches are left untouched**.
- The read path and derived state — see *Read path and derived state*: the
  query-engine hierarchical include returns the nested tree, and
  currently-watching / fully-watched are derived via existence/aggregate filters
  (specials excluded from fully-watched).

Slice-specific constraints (not to be confused with later slices):

- **Do not build the Episode Resolver here.** The core event path targets an
  episode by its entity id directly; positional resolution arrives with the
  importers (slice 02).
- **Do not touch import adapters, integration sinks, the progress-policy trigger,
  podcasts, or legacy-bootstrap** in this slice.
- Anime, manga, and all other media types must remain unchanged — verify their
  progress/auto-complete behavior is unaffected.

## Acceptance criteria

- [ ] `show-season` and `show-episode` entity schemas plus `show-to-show-season`
      and `show-season-to-show-episode` relationship schemas are registered as
      structural builtins (no media-tracker link; no standalone browse view).
- [ ] Populating a show creates one entity per season and one per episode (keyed
      on the provider-native `externalId`) with relationship rows linking
      show→season and season→episode; re-populating the same show creates no
      duplicate entities or relationships.
- [ ] The show properties no longer contain the nested seasons array;
      `totalSeasons` and `totalEpisodes` are written at population time.
- [ ] `show` no longer exposes a `progress` event; `show-episode` exposes
      `progress` + `complete`; `show-season` exposes `complete`.
- [ ] A `progress` event at 100% on an episode auto-creates a `complete` event on
      that same episode; anime/manga auto-complete behavior is unchanged.
- [ ] A single query-engine query returns a show with seasons ordered by
      `seasonNumber` and episodes ordered by `episodeNumber`, each episode
      indicating whether a progress/complete event exists.
- [ ] "Currently watching" and "fully watched" for a show are derivable through
      query-engine existence/aggregate filters (season 0 excluded from
      fully-watched); no dedicated endpoint is added.
- [ ] Seasons and episodes do not appear as standalone browsable/searchable
      library items.
- [ ] Tests pass: Child-Entity Tree Processor isolation test; show-detail nested
      include E2E; completion+derivation E2E (see *Testing Decisions*).

## User stories addressed

- User stories 1, 2, 3, 4, 5, 6, 7, 8, 9
- User stories 12, 13, 18
- User stories 22, 23, 24, 25, 26, 27, 28, 30
