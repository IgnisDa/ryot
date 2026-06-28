# Population Context and Media Entity-Update Detectors

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Update-occurrence dispatch from provider population and the first five media detectors, per the
PRD's Provider Population Dispatch, Sandbox Scripts (population block), Built-In Signal Catalog,
and Detection Behavior sections.

Provider population already returns per-activity envelopes with classified entity mutation
outcomes. This slice dispatches occurrences from them: one occurrence per material entity
mutation (noops dispatch nothing), from the workflow body as the next durable step. Thread the
population block into the automation context — scope entity (the parent show for show-season and
show-episode mutations, the podcast for podcast episodes, the sync anchor for top-level syncs),
the root-previously-populated flag, and the owning season for episode-scoped occurrences — with
the scope reference propagated through nested syncs. Only seeded built-in media detectors may
target these internal update/delete occurrences.

Seed the five signal schemas with the PRD's property contracts and related-users audience
policies resolving monitors of the parent media through the media-monitoring relationship, plus
their detector scripts and global built-in rules:

- `media.status.changed` (parent media-entity update)
- `media.content-count.changed` (anime/manga entity update; numeric counts belong only here)
- `media.release-date.changed` (parent media update for publish years; show-episode update for
  episode dates; discriminated variant contract)
- `media.episode.name.changed` and `media.episode.images.changed` (episode-entity updates)

Detection behavior follows the PRD exactly: hierarchical detectors emit nothing when the root was
not previously populated; episode detectors emit nothing for special seasons; image comparison is
order- and duplicate-insensitive; release-date transitions with a null side emit nothing; each
fact emits independently with no cross-occurrence suppression. Detectors read only their
snapshots and the population block — no entity queries.

Builds on tasks 04, 05, and 10. Verifiable end-to-end: refresh a monitored show whose provider
data changed and observe the correct signals and notifications.

## Acceptance criteria

- [ ] Material entity updates in population dispatch one occurrence each with before/after
      snapshots; noops dispatch nothing; replay does not duplicate
- [ ] Show-episode entity updates carry the parent show as scope entity and the owning season;
      detectors construct correct subjects and names without post-commit entity queries
- [ ] All five schemas seed with the PRD's exact contracts, accepting supported variants and
      rejecting unknown or variant-incomplete fields, including nullable episode-name transitions
      and an episode date change without a season number
- [ ] Initial population of a monitored entity emits no hierarchical signals
- [ ] Special-season episode changes emit nothing; sibling episode changes emit normally
- [ ] Image comparison is order- and duplicate-insensitive; null-sided release-date transitions
      emit nothing
- [ ] Each signal's audience is exactly the users monitoring the parent media; unmonitored
      changes notify nobody

## User stories addressed

- User story 3
- User story 4
- User story 5
- User story 6
- User story 7
- User story 21
- User story 22
