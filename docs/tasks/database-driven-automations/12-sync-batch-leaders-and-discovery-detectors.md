# Sync Batch Leaders and Discovery Detectors

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** done

## What to build

Relationship-sync occurrence dispatch with batch leadership, and the two count-oriented
detectors, per the PRD's Provider Population Dispatch, Sandbox Scripts (batch descriptor), and
Detection Behavior sections.

Dispatch one occurrence per material relationship mutation from the sync's outcome envelope, with
occurrence IDs derived from the sync execution ID plus relationship schema, direction, endpoints,
and operation — never database return order or loop position. Sync occurrences carry a batch
descriptor scoped to the sync's anchor, relationship schema, and direction (batch ID, leader
flag, before/after counts, created/updated/deleted counts), with the leader selected
deterministically from stable mutation identity. The full batch is never duplicated into every
snapshot.

Seed the two schemas with the PRD's contracts and related-users audience policies on the parent
media's monitors, plus detector scripts and global rules:

- `media.season-count.changed`: emitted by the leader of a show-to-season sync when the net count
  changes.
- `media.episode.discovered`: one aggregate emission by the leader of a show-season-to-episode or
  podcast-to-episode sync when the created count is positive, carrying the discovered count and
  old/new totals (season number for shows).

Both stay silent on first population of the root. Independence holds: a refresh adding a season
and its episodes emits both signals, and episode-field changes emit alongside a same-refresh
discovery — no cross-occurrence suppression.

Builds on task 11. Verifiable end-to-end: a refresh that discovers new episodes on a monitored
show notifies its monitors with an accurate count.

## Acceptance criteria

- [x] Sync occurrence IDs are independent of database return order; replay does not duplicate
      occurrences, signals, or runs
- [x] Exactly one leader exists per batch, selected deterministically; count detectors emit only
      on the leader; per-record detectors still process their own occurrences
- [x] Episode discovery fires with an accurate created count (genuinely new rows classify as
      creates) and correct old/new totals
- [x] Season-count changes emit only on net count change
- [x] Season-count and episode-discovery signals both emit when both facts occur in one refresh
- [x] Neither signal emits during first population of the root

## Implementation notes

- Relationship outcomes from both child-set and related-entity-group syncs now dispatch after
  their activity transaction commits. This shared path supplies the hierarchy detectors here and
  the association detectors in task 13 without introducing a second sync dispatcher.
- Batch and occurrence IDs are SHA-256 identities over the workflow execution, relationship
  schema, direction, stable endpoints, operation, and anchor as applicable. Leadership is selected
  from the lexicographically first stable mutation identity, independent of outcome order.
- The relationship detector is seeded for create, update, and delete operations on all three
  hierarchy schemas so a deterministic leader can execute regardless of its mutation operation.
- The media-monitoring E2E suite now proves first-population silence and a later one-episode
  discovery delivered through the signal subscription to a monitoring user.

## User stories addressed

- User story 1
- User story 2
- User story 21
