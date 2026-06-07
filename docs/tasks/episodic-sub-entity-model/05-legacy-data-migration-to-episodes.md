# Legacy data migration → episodes

**Parent Plan:** [Episodic Sub-Entity Model](./README.md)

**Type:** AFK

**Status:** done

## What to build

Update the one-time V1→V2 migration so that historical show/podcast structural
data and watch/review history land in the new episode model.

This slice implements, per the parent PRD's *Legacy bootstrap* section:

- A new migration step, running **after the parent metadata entities are migrated
  and before events**, that explodes the previous version's stored show/podcast
  structural data into `show-season` / `show-episode` / `podcast-episode` entities
  (keyed on the provider-native ids already present in that data, marked
  populated) plus the relationship rows linking them.
- Updating the seen and review migrations to resolve the episode entity
  positionally (the legacy rows carry only positional season/episode numbers) and
  set each event's target entity to the resolved episode, producing per-episode
  progress and review events.
- Keeping the completion backfill emitting **entity-level** show/podcast
  `complete` events (its existing behavior), not per-season or per-episode.

Slice-specific constraints:

- Depends on the sub-entity schemas + processor concepts (slice 01) and positional
  resolution (slice 02 / slice 04). Migration is SQL-based; reuse the same
  parent + ordering-number resolution logic.
- Per the parent PRD's *Out of Scope* and *Testing Decisions*, the
  legacy-bootstrap **end-to-end test is deferred**. This slice's verification is:
  the migration code builds, the existing legacy-bootstrap suite stays green, and
  a spot check confirms sub-entities are created and events resolve to episodes.

## Acceptance criteria

- [x] The migration creates `show-season` / `show-episode` / `podcast-episode`
      entities (using the stored native ids) and the linking relationship rows,
      sequenced after metadata and before events.
- [x] Migrated seen and review events resolve to the correct episode entity
      positionally; per-episode progress and review events are produced.
- [x] The completion backfill still emits entity-level show/podcast `complete`
      events.
- [x] The build passes and the existing legacy-bootstrap suite is green; no new
      end-to-end test is required (deferred per the parent PRD).

## User stories addressed

- User story 19
- User story 20
- User story 21
