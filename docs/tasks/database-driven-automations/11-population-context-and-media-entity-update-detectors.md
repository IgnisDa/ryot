# Population Context and Media Entity-Update Detectors

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** done

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

- [x] Material entity updates in population dispatch one occurrence each with before/after
      snapshots; noops dispatch nothing; replay does not duplicate
- [x] Show-episode entity updates carry the parent show as scope entity and the owning season;
      detectors construct correct subjects and names without post-commit entity queries
- [x] All five schemas seed with the PRD's exact contracts, accepting supported variants and
      rejecting unknown or variant-incomplete fields, including nullable episode-name transitions
      and an episode date change without a season number
- [x] Initial population of a monitored entity emits no hierarchical signals
- [x] Special-season episode changes emit nothing; sibling episode changes emit normally
- [x] Image comparison is order- and duplicate-insensitive; null-sided release-date transitions
      emit nothing
- [x] Each signal's audience is exactly the users monitoring the parent media; unmonitored
      changes notify nobody

## Implementation notes

- Lifecycle dispatch now accepts create/update/delete operations, before/after snapshots, and the
  trusted population block. Provider-population activities capture their commit time and the
  workflow body dispatches each material entity outcome immediately after its transaction with a
  deterministic occurrence ID; noop outcomes are ignored.
- Population roots retain the requesting origin. Refreshes use `provider_refresh`, direct library
  imports use `api`, one-time imports use `import`, integration imports use `integration`, and
  bootstrap population uses `bootstrap`.
- Nested child scopes retain the root media reference. Show-episode updates additionally receive
  their owning season's number and name, derived from the committed season snapshot.
- The five active media signal schemas use the source side of the built-in `media-monitoring`
  relationship for their related-user audience. Conditional property rules enforce both variants
  of `media.release-date.changed`, including rejecting null values for conditionally required
  fields.
- One shared built-in `automation.media-entity-updated` detector owns all five entity-update
  signals. It is seeded only on update rules for applicable parent and episode schemas, reads only
  lifecycle snapshots/population context, and may emit multiple independent signals from one
  occurrence. A shared script was used instead of five near-identical scripts to keep one producer
  and one comparison implementation per entity-update scope.
- The shared notification script formats all five new signal snapshots, preserving the existing
  media-monitoring message wording while remaining independent of entity queries.

## User stories addressed

- User story 3
- User story 4
- User story 5
- User story 6
- User story 7
- User story 21
- User story 22
