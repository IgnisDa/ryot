# Order 19 — History and Review Controls Plan

Approved on **2026-11-10**. This plan closes the history/review row of the
[gap analysis](v1-v2-port-gap-analysis.md#differences-that-need-a-decision-not-an-automatic-implementation-slot):
alternate rating scales, positional reviews, consumption-to-review links, episode retargeting,
multiple consumption sources, dated/manual-time progress and manga volume-only next entry.

Ryot is greenfield: event property shapes, bridge capabilities and SDK exports change in place, with
no compatibility paths. Backups and V1 migrations follow the new shapes.

## Product decisions

| Topic | Decision |
| --- | --- |
| Rating scales | Four user-selectable scales: out of 100 (default), out of 10, 5 stars with halves, 3-point smiley. Storage stays 0–100. The scale is a kernel preference, so Media, Fitness and kernel collection reviews share it. Changing it never rewrites data. |
| Review visibility | Not carried over. Reviews remain owner-only events with no visibility, comments or likes. Links and badges introduced here are owner-only. |
| Positional reviews | Anime/Manga reviews may name one episode, chapter or volume. Shows/Podcasts keep the entity model: a review about a season or episode is stored on that child entity. |
| Consumption-to-review link | A review optionally references the one consumption event it is about. History events carry no review references, so linking never refolds history or contends with integrations. Several reviews may reference one event. |
| Fitness exercise notes | Remain notes: text required, no spoiler flag. They share the review rating contract, patch helpers and rating UI, so ratings follow the user's scale. |
| Manga volumes | A real tracking unit. Each run is tracked in chapters or volumes; next entry, progress and completion use that unit's total; analytics reports volumes as their own quantity. Switching units starts a new run. Volumes are never converted to chapters. |
| Dates | Day-only by default with an optional **Add time**. `now` stays an exact instant. Date-only entries keep `calendarDate` and stay out of hourly analytics. |
| Batch episode logging | No time spent. Episode runtimes already provide estimates; exact time is edited on an individual episode event. |
| Episode retargeting | Show/Podcast episode events move only between episodes of the same parent. Moving history between titles stays with **Merge my data into…**. Anime/Manga corrections edit the position. |

## Workstreams

Dependencies: **A** precedes **C**, **E** and **H**. **B**, **F** and **G** are independent. **D**
needs the kernel reference work in D1 and the review picker from C. Each workstream follows the
repository workflow (checks, then affected tests, review, cleanup).

### A. One Media position model

Replace `animeEpisode`, `mangaChapter`, `mangaVolume` and `consumedItem` with one property named
`position`, shaped `MediaPosition = { unit: "episodes" | "chapters" | "volumes", position, volume? }`
and owned by `plugins/media/shared/consumption.ts`. The event schema gives it meaning:

| Event | Meaning of `position` |
| --- | --- |
| `progress`, `dropped`, `on_hold` (Anime/Manga) | Cumulative consumed-through position in the run's unit. |
| `item-complete` | Identity of one independently completed item. |
| `list-state` | Snapshot position. AniList manga keeps its chapter position with volume context. |
| `review` | The item the review is about. |

Rules: Anime uses integer `episodes`. Manga uses fractional `chapters` or `volumes`; `volume` is
chapter context only and is valid only with `chapters`. `sourceProgress` stays separate raw evidence
but reuses the unit literal.

- **Manifest:** `manifest/schemas/{entity,consumption}.ts` declare `position` per schema, with choices
  derived from the shared literals. `media.consumption` keeps the cross-field rules.
- **Shared:** delete `positionalProperties` and per-type position keys from `media-schema-slugs.ts`,
  `media-activity-fields.ts` and `list-state.ts`. Read positions with
  `jsonPath(properties, "position", …)` in `lifecycle-expressions.ts`, `lifecycle-list-recipes.ts`,
  `upcoming-recipes.ts`, `calendar-sources.ts`, `analytics-recipes.ts` and the anime/manga recipes.
- **Operations:** `MediaActivityEntry` progress and `MediaActivityPatch` accept `position: MediaPosition`
  in place of the integer `position`. The fractional-chapter restriction goes away.
- **Fold/allocation:** `consumption-allocation.ts` and `backend/fold/{history,consumption}.ts` read
  the unified property.
- **Writers:** AniList/MyAnimeList imports, AniList and Komga yanks, and integration admission
  write `position`.
- **Client:** one formatter in `client/media/activity-copy.ts` ("Ep 5", "Ch 10.5", "Vol 3",
  "Ch 12 · Vol 2") serves activity rows, reviews, next-up labels, home labels and analytics records.
- **Migration:** rewrite `seen-mapping.ts`, `review-mapping.ts` and
  `integration-progress-cache-mapping.ts` to the new property.

### B. Rating scales

- **Contract:** `packages/contract/src/schema/user-preferences.ts` adds
  `ratingScale: "hundred" | "ten" | "five" | "three-point"`. A new
  `packages/contract/src/modules/events/rating-scale.ts` beside `review.ts` owns the scale metadata
  (max, step, input kind), `toScale`, `fromScale` and `formatRating`, plus one three-point rule:
  stored values below 100/3 are sad, below 200/3 neutral, the rest happy; input stores 0, 50 or 100.
  Zero is a valid rating.
- **Bridge:** replace the reporting-preferences capability with a user-preferences capability that
  carries `{ timeZone, ratingScale }`. This covers `plugin-client-contract` bridge capabilities, the
  kernel host `pages/bridge/user-settings.ts`, the SDK session/client/adapter, and a `useUserPreferences`
  hook that replaces `useReportingPreferences` at every call site. The publication visitor host
  answers with defaults.
- **Kernel client:** add a scale control to settings preferences, and make the collection review
  screen use the shared display.
- **UI SDK:** `RatingInput` (number, half-star or three-choice by scale) and `RatingValue`.
  `ReviewComposer` uses `RatingInput`.
- **Rating displays:** replace every hand-formatted rating with `RatingValue`: Media
  `activity-timeline.ts`, `activity-rows.tsx`, `presentation.tsx`, `analytics/summary.tsx`,
  `analytics/model.ts`, Fitness `exercise/notes.tsx`, and kernel collection reviews.
- **Fitness:** delete `StarRating` and the conversion in `exercise/details-model.ts`.
  `exercise-note-operations.ts` and `backend/operations/exercise-notes.ts` reuse `ReviewRating` and
  the shared patch helpers. The manifest builds its note fields from shared rating fields, keeping
  text required.
- **Browse:** a `rating` browse value type in the manifest contract. Table cells
  (`plugin-client-sdk` display values) and number filters show and accept the user's scale. Media
  `browse.ts`, `library-summary.ts`, `entity-presentations.ts` and `analytics-recipes.ts` share one
  user-rating average expression in `plugins/media/shared`.
- **Provider ratings:** the Media header's provider rating stays a 0–100 provider fact, not a user
  rating.
- **Migration:** map V1 `review_scale` (OutOfHundred, OutOfTen, OutOfFive, ThreePointSmiley) in
  `user-settings-mapping.ts`.

### C. Positional reviews

- **Operations:** `MediaReviewCreateInput` and `MediaReviewUpdateInput` take an optional
  `position: MediaPosition | null` for Anime/Manga targets. Updates can clear it. Other targets
  reject it.
- **Read and display:** review selections in `media-recipes.ts` and `episodic-recipes.ts` select
  `position`, and rows show "Review · Ep 5". Show activity includes `show-season` reviews.
- **Composer:** `ReviewComposer` gains a subject slot. Media provides a "Review of" picker:
  - Whole title, or an Anime/Manga number prefilled from the latest position.
  - For Shows: whole show, season or episode. Podcasts: whole podcast or episode. The review is
    created on the selected child entity.
- **Entry points:** episode details and season headers offer **Review**.
- **Episode picker:** extract `ActivitySeasonSelector`, `EpisodeList` and the show/podcast pagers
  from `activity-log/sheet.tsx` into one Media client episode picker, used by the log sheet, edit
  sheet and review picker.
- **Migration:** V1 show reviews that name only a season move to the `show-season` entity instead of
  losing the season.

### D. Consumption-to-review link

- **D1 (kernel, product-agnostic):** live integrity for `reference: { kind: "event-id" }` string
  properties.
  - Writes require the referenced event to exist and belong to the same user.
  - A kernel-maintained reverse index (event → referencing events) is updated with event writes.
  - Deleting a referenced event, including fold-deleted automatic completions, entity cascades and
    user-data clears, removes optional references in the same transaction.
  - Backup restore orders referenced events before referrers. Merge keeps IDs.
  - Documented in `kernel/backend/src/modules/events/README.md`.
- **Media schema:** the review event declares optional `consumptionEventId` as an event-id
  reference.
- **Operations:** review create and update accept `consumptionEventId | null`. The target must be a
  `complete`, `item-complete`, `progress`, `dropped` or `on_hold` event on the review's entity,
  including automatic completions.
- **Read:** review rows show the linked occurrence ("About your watch on 3 Nov"). Consumption rows
  show a **Reviewed** badge from a reverse lookup recipe and open the review.
- **Composer:** an "About" select lists recent consumption events of the chosen subject. The
  post-completion review flow preselects the completion once the background submission settles.
- **Migration:** `seen.review_id` becomes the review's `consumptionEventId`. When several seen rows
  share one review, the latest finished row wins and the rest are reported as anomalies.

### E. Episode retargeting

- **Operation:** `MediaActivityPatch` adds `episodeEntityId` for `complete` and `progress` events on
  `show-episode` and `podcast-episode`. The new episode must be visible and belong to the same
  parent; otherwise the edit is rejected.
- **Policy:** `policy.media-episodic-session` runs on updates that change `entityId` and recomputes
  `sessionEntityId`. Season-0 specials stay sessionless, so moving between a special and a regular
  episode changes which fold owns the event; both affected subjects refold.
- **Client:** the edit sheet shows the shared episode picker for episode events.

### F. Multiple consumption sources

- **Contract:** `consumedOn` becomes a string array:
  - case-insensitively unique, at most 10 items, each 1–100 trimmed characters;
  - applied in the manifest, `MediaActivityEntry`, `MediaActivityPatch` and selections.
- **Logging:** `rememberConsumedOn` appends each new value under the existing 30-item limit.
- **Suggestions:** `activity-log-recipes.ts` groups over array elements with `jsonElementsJoin`.
- **Fold:** coverage completions copy the ordered, deduplicated union of covered sources;
  progress-derived completions copy their source's array.
- **Writers:** integrations and imports write one-item arrays (the browser extension keeps the
  hostname).
- **UI SDK:** add a creatable tag input. Media `SourceField` becomes multi-value with the existing
  suggestion chips.
- **Migration:** keep V1's full `providers_consumed_on` array.

### G. Dated and manual-time progress

- **Started date:** progress sends and writes `startedOn` (`activity-log/state.ts` and
  `media-activity-log.sandbox.ts`), and edits keep it.
- **Time spent:** progress already supports it. Batch episodes stay without time spent by decision.
- **Shared UI:** move Fitness `DateTimeField` and `useDateTimeInput` into `plugin-ui-sdk`.
  Media `WhenField` uses them for an optional time of day: with a time, it writes an exact instant
  and no `calendarDate`. Fitness imports the moved components.
- **Duration field:** move Media `TimeSpentField` and `parseTimeSpent` into a `plugin-ui-sdk`
  `DurationField` (hours and minutes, value in minutes).

### H. Manga volume-only next entry

- **Basis and fold:** consumption basis gains `volumes`, mapping to `volumes/volumes` for volume
  runs. A run's unit is fixed by its first positional observation; a different unit starts a new
  run.
- **Lifecycle:** `latestPosition` returns `{ unit, position }`. Progress percent divides by that
  unit's total. A volume position at or above the volume total completes the title.
- **Log sheet:** next entry is the latest position + 1 in the same unit, capped at that unit's
  total. The manga log sheet gains a Chapter/Volume toggle defaulting to the latest unit.
- **Analytics:** volumes appear as their own manga quantity.
- **Docs:** update the README rule that volumes are annotation-only.

## Documentation

Update `plugins/media/README.md` (Operations, Lifecycle, Consumption source facts, Canonical
allocation), `plugins/fitness/README.md`, `packages/plugin-ui-sdk/README.md`,
`packages/plugin-client-sdk` bridge documentation, `kernel/backend/src/modules/events/README.md`,
`apps/server/src/migrations/README.md` and user documentation in `apps/docs`. When the order
closes, record the acceptance results in the gap analysis.

## Acceptance

- **Rating scale:**
  - A rating entered on each scale stores the converted 0–100 value.
  - Every rating surface (Media rows, cards, analytics, browse cells and filters, Fitness notes,
    collection reviews) displays the user's scale.
  - Publication visitors get defaults.
- **Positional reviews:** Anime episode, manga chapter and manga volume reviews round-trip; show
  season and episode reviews land on the child entity and appear in show activity.
- **Review links:**
  - A review links to one consumption event of its entity; other entities and other users are
    rejected.
  - Deleting the event, a fold-removed automatic completion, an entity clear or a merge keeps the
    reference valid or removes it.
  - Backup round-trip keeps the link.
- **Episode retargeting:** an episode completion moves to another episode of the same show and
  coverage refolds. A cross-parent target is rejected.
- **Multiple sources:** several sources round-trip, suggestions count each element, and a coverage
  completion carries the union.
- **Started date:** a progress started date persists and edits keep it. An optional time of day
  writes an exact instant.
- **Manga volumes:**
  - A volume-only manga suggests the next volume and completes at the volume total.
  - Analytics shows volumes.
  - A unit switch starts a new run.
- **Migration:** a real V1 dump maps review scale, review links, full source arrays, positional
  reviews and season-only show reviews, with anomalies reported.
- **Validation:** focused API and browser e2e files per workstream, affected package tests, and the
  final repository check.
