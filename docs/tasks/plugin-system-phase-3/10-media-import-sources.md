# Step 4d — Media Import Sources into `plugins/media`

**Parent Plan:** [Plugin System — Phase 3: Capability Migrations](./README.md)

**Type:** AFK

**Status:** done

## What to build

Before starting, read `docs/plans/plugin-system/00-overview.md` in full and then
`docs/plans/plugin-system/03-phase-3-capability-migrations.md` in full — §4 is the authoritative
spec. Do not begin until Step 4c (task 09) is done and its gates pass.

Move all sixteen media import sources into `plugins/media`, declared through the `importSources`
manifest section and consumed by the plugin's own import workflow (which already owns
resolution/population orchestration from task 06):

netflix, goodreads, storygraph, hardcover, anilist, trakt, imdb, igdb, grouvee, movary,
myanimelist, watcharr, jellyfin, plex, audiobookshelf, media-tracker.

File-based sources parse inside the sandbox using `artifact-read` plus `fflate` (zip, gunzip),
`papaparse` (CSV), and `fast-xml-parser` (MyAnimeList). Credentialed sources fetch through
`httpCall`. Output crosses via scratch-dir chunk files and a small return manifest; the kernel
harvests it and performs every entity, event, and relationship write.

**`episodeLocator` becomes `subjectEntityId`.** Replace the locator on the import event envelope
with an optional, already-resolved `subjectEntityId`. The plugin workflow resolves subjects between
population and writing using its own `resolve-episodes` operation, so the kernel's writing path
collapses to `subjectEntityId ?? group.entityId`. Delete `imports/media/event-target-workflow.ts`
and the episode branches of `imports/media/writing-failures-workflow.ts` with **no kernel
replacement**. §4 records the rejected alternative; do not reintroduce it.

**Netflix gets simpler, not harder.** Its two-phase `"netflix-search-planned"` dance exists only
because the kernel cannot call provider search mid-parse. A plugin script calls provider search
in-process (as `metadata-lookup.sandbox.ts` does) and the entire phase disappears. Moving it also
retires the last kernel consumer of `lib/shared/title-parsing.ts` and `title-matching.ts` — delete
both files and their tests, as step 2 scheduled.

Delete `imports/media-workflow.ts`, the media orchestration under `imports/media/`, and every
adapter under `imports/sources/`. What survives is named in §4 "Delete": run rows with status,
progress, and counters; failure rows and `ImportRunFailureStage`; artifact upload, materialization,
and cleanup; registry-driven source listing and workflow dispatch; and the writes.

Media adapter unit tests move into `plugins/media` with assertions preserved. Re-point the Watcharr
e2e test with assertions preserved — including the unresolvable-locator failure assertion, which is
the behavioral spec for the `subjectEntityId` change (an unresolvable subject must still be reported
as a failure and must never be mis-attached to the parent entity).

## Acceptance criteria

- [x] All sixteen media import sources run as `plugins/media` adapters declared through
      `importSources`, parsing in-sandbox with the approved dependencies
- [x] `episodeLocator` is replaced by `subjectEntityId`; the kernel writing path is
      `subjectEntityId ?? group.entityId`; `event-target-workflow.ts` and the episode branches of
      `writing-failures-workflow.ts` are deleted with no replacement
- [x] The kernel no longer imports `@ryot/plugin-media` from `modules/imports`
- [x] Netflix's `"netflix-search-planned"` two-phase path is gone; `lib/shared/title-parsing.ts`,
      `title-matching.ts`, and their tests are deleted
- [x] `modules/imports` contains **zero provider-specific and zero domain-specific code**; only the
      framework named in plan §4 survives
- [x] Media adapter unit tests live in `plugins/media` with assertions preserved
- [x] `imports/` e2e suites re-pointed with assertions preserved, including the unresolvable-subject
      failure assertion
- [ ] The branch stays shippable: backend `check` + unit tests, the full e2e suite, and the
      `app-client` check all pass (cross-phase invariant 1)

## Deferred e2e follow-up

The owner marked this task done on 2026-07-28 while deferring the affected imports e2e failure. The
backend check, all 903 backend unit tests, and the app-client check pass. The focused imports file is
not green: Hevy failed once in the full file but passes alone, while Watcharr times out with its run
left `running`. Watcharr reaches the generic writer, records the expected S1E99
`provider_resolution` failure, and its nested `EventCreateWorkflow` completes event, lifecycle, and
membership steps, but the generic parent does not resume before the poll timeout. A nested durable
workflow replay/resumption issue, potentially involving the progress auto-complete child, is the
leading theory. The assertions were not changed or weakened, and this must be closed before the
Phase 3 gate.

## User stories addressed

- User story 27
- User story 29
- User story 30
- User story 38
- User story 39
- User story 43
- User story 44
- User story 45
- User story 46
