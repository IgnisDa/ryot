# Show import history → episodes

**Parent Plan:** [Episodic Sub-Entity Model](./README.md)

**Type:** AFK

**Status:** done

## What to build

Make imported show watch-history land on the correct episode entity. This slice
builds the resolution machinery for positional progress sources and wires up the
show import adapters.

This slice implements, per the parent PRD:

- The **Episode Resolver** deep module — see *Module: Episode Resolver*. This
  slice builds and first uses `resolveShowEpisode` (the show two-hop traversal).
  `resolvePodcastEpisode` is added in slice 04.
- The import-pipeline changes — see *Import pipeline and adapters* and *Identity,
  idempotency, and resolution*: the import event model carries an optional episode
  locator (season number + episode number); the pipeline resolves it via the
  Episode Resolver **after the parent show is populated** and sets the event's
  target entity to the resolved episode; unresolvable locators are dropped and
  logged.
- Updating the six show import adapters (Jellyfin/Emby, Trakt, Netflix, Plex,
  Watcharr, the generic media tracker) to emit the locator instead of writing
  positional numbers into event properties.

Slice-specific constraints:

- Relies on the show entity/episode schemas, population, and the episode
  `progress`/`complete` events from slice 01.
- Live integration sinks and the progress-policy trigger are out of scope here
  (slice 03). Podcast import is out of scope here (slice 04). Anime/manga import
  adapters are untouched.
- "Populate-first" holds because the import flow populates (or finds an
  already-populated) show before creating its events — do not add a separate
  episode-creation path in importers; importers only resolve.

## Acceptance criteria

- [x] `resolveShowEpisode(showEntityId, seasonNumber, episodeNumber)` returns the
      correct episode entity id, and returns null on a missing or ambiguous match.
- [x] Importing show watch-history attaches each per-episode event to the resolved
      episode entity.
- [x] An episode locator that cannot be resolved (e.g. provider numbering
      mismatch) is skipped and logged, never attached to the wrong episode or to
      the show.
- [x] The six show import adapters no longer write positional season/episode keys
      into event properties.
- [x] Tests pass: Episode Resolver isolation test; progress-resolution E2E for the
      import path including the drop-on-miss case (see *Testing Decisions*).

## Implementation Notes

- Backend implementation and deterministic tests are complete.
- The live import-path e2e (`Watcharr Show Import E2E (episode resolution)` in
  `tests/src/tests/imports.test.ts`) pre-seeds a populated show / season / episode tree
  to avoid external provider calls, then imports one resolvable and one unresolvable
  episode locator. It asserts the resolvable progress lands on the episode entity, the
  show keeps no progress event, and the unresolvable locator is logged as a failure.
- The earlier stall at `writing_events` (`progress = 90`) was a pre-existing bug in the
  media import workflow, surfaced by this being the first e2e test to write an event
  that fires an after-create trigger through `events.createForImport`. The write-event
  step executed the nested `EventCreateWorkflow` with a freshly-generated random
  `executionId`. When the 100%-progress episode event fired the auto-complete trigger,
  that child workflow durably suspended (to dispatch the trigger workflow), which
  suspended and replayed the import workflow; each replay minted a new random
  `executionId`, so the child workflow was never idempotent and the import looped
  forever, spawning runaway events. The fix threads a deterministic `executionId`
  (`${importExecutionId}-event-${groupIndex}-${eventIndex}`) into `createForImport` /
  `createForIntegration`, matching how `resolveExternalId` / `importEntity` already key
  their child workflows, so replays resolve to the same child and converge.

## User stories addressed

- User story 14
- User story 16
- User story 29
