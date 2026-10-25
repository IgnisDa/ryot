# Order 16 — Analytics implementation plan

## Status and handoff

This is the approved engineering plan for Order 16 in
[the V1 → V2 gap analysis](v1-v2-port-gap-analysis.md#phase-4--discovery-analytics-and-lower-priority-account-controls).
It is reference material. Maintained user documentation belongs in `apps/docs`.

Planning and code research completed on **2026-10-28**, and the owner approved all
recommendations and the five final decision groups recorded below. Order 16 is implemented in the
`[o16]` commits. A follow-up redesign in the `[v1-v2-port-gap-o16-followup]` commits replaced the
readiness gating and workaround machinery: processing state comes from projection status, recipes
take the resolved reporting selection, values are never hidden behind processing state, and shared
reporting queries, copy and tables live in the plugin SDKs. **Order 16 remains in progress** until
the redesigned code passes end-to-end acceptance and real-dump migration validation; the evidence
below predates the redesign.

Paths describe the researched checkout; proposed files and declarations are identified as such.
Recheck nearby code before relying on a path.

No product decision remains open. Query performance, exact internal schema design and a chart
prototype are early implementation gates, not reasons to ask the owner to approve the same product
choices again. Ask if new evidence requires changing approved behavior or widening scope. Discuss
any proposed new chart dependency with the owner before adding it. This document does not authorize
a commit or implementation of other roadmap items.

## 1. Approved product contract

| Topic                        | Approved behavior                                                                                                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Destination                  | One global **Analytics** saved view beside Calendar, with plugin-owned Media and Fitness sections.                                                                                                                           |
| Navigation                   | Desktop sidebar and mobile drawer, in the global Saved Views section. Canonical URL `/v/k/analytics`; searchable through the command center. Existing sidebar visibility/order controls apply. Home summaries link here.     |
| Shared controls              | Date range, comparison period, grouping and reporting timezone apply consistently to the contributed sections. Mobile provides section navigation.                                                                           |
| One metric implementation    | Home cards, detail consumption summaries and Analytics share canonical domain metric definitions. Replace conflicting calculations. Current coverage and lifetime consumption remain distinct, clearly labelled measures.    |
| Partial consumption          | Include reliably recorded progress, including unfinished media. Quantities and manual time mean the cumulative total reached in the current consumption run.                                                                 |
| Attribution                  | Attribute each increase to its recorded observation. Do not spread a completion evenly between start and finish dates.                                                                                                       |
| Backward progress            | A lower new cumulative reading adds no consumption. Correct earlier consumption through Edit. A completed run followed by new progress starts another run.                                                                   |
| Repeats                      | Count each consumption occurrence. Report distinct titles separately. Preserve independent explicit records under Order 1; do not heuristically deduplicate them.                                                            |
| Episodic media               | Report title completions separately from consumed episode occurrences. Do not add parent and child durations for the same consumption. Specials count as consumption even though they do not complete a parent.              |
| Historical estimates         | Retain the metadata basis used when consumption was recorded. Later provider refreshes must not rewrite past estimates. Distinguish recorded amounts from metadata estimates.                                                |
| Unknown dates                | Include in all-time totals and a visible undated count. Exclude from dated charts and comparisons. A placeholder ordering timestamp is not a consumption date.                                                               |
| Date precision               | Preserve exact instant, calendar-date-only and unknown evidence. Date-only records stay on their recorded calendar date and never become fabricated hourly activity.                                                         |
| Unknown quantities           | Show the known subtotal and missing-data coverage. Unknown is not zero. Do not silently use current provider metadata to fill a missing historical basis.                                                                    |
| Imported cumulative progress | When the source supplies no reliable consumption date, treat cumulative progress as an undated baseline. Do not put an entire imported history on its import or last-update day.                                             |
| Synced list state            | Exclude list-state snapshots from consumption totals, with a clear explanation. AniList state, repeat counts and partial dates do not establish individual consumption occurrences. Actual imported history counts normally. |
| Reporting timezone           | Account-level IANA timezone, initially taken from the device and editable in preferences. Analytics and home reporting use it. Device travel does not silently move reporting boundaries.                                    |
| Fitness units                | Keep kg, km, seconds and kcal in storage; convert for display through existing preferences.                                                                                                                                  |
| Workout duration             | Use recorded active duration. Keep set duration and planned rest separate, so they are not added again to workout duration. Missing active duration stays unknown.                                                           |
| Rest                         | Label the existing recorded rest targets **Planned rest**. Actual elapsed-rest instrumentation is outside this item.                                                                                                         |
| Fitness taxonomy             | Freeze recorded workout muscle/equipment assignments so later exercise taxonomy changes do not rewrite historical rankings.                                                                                                  |
| Exclusions                   | Do not add `exclude_from_analytics`. Broader exercise merge is not part of this item.                                                                                                                                        |
| Access                       | All Order 16 analytics and date ranges are available without Pro gating.                                                                                                                                                     |
| Charts                       | Polished, responsive, interactive charts with useful mobile, light/dark, keyboard and reduced-motion behavior. Start with the existing chart dependency; discuss any new dependency before adding it.                        |
| Greenfield                   | Breaking schema and API changes are allowed. No V2 compatibility readers, retained obsolete APIs or parallel calculation paths. Keep repository artifact/protocol/API/compiler version constants unchanged.                  |

The reporting timezone does not automatically change workout/reminder input-timezone semantics.
Date entry retains explicit source evidence; reporting controls determine how exact instants are
grouped. Hiding a navigation view must not become a permission to discard its historical data.

## 2. Research findings and source map

Read the applicable `AGENTS.md` and feature READMEs before editing. Relevant owners include Media,
kernel backend/client, contract, client SDK/contract/compiler/UI SDK, kernel renderers, migrations,
backups and e2e. Follow root ownership, Effect, testing, validation and cleanup rules.

| Concern                      | Existing source and implication                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 metric inventory          | `crates/models/dependent/src/analytics.rs`, `crates/services/statistics/src/{analytics_operations,daily_activity_operations}.rs`, `crates/utils/dependent/analytics/src/lib.rs`. Use as capability evidence, not a prescription for a daily summary table.                                                                                                        |
| V1 UI/access                 | `crates/frontend/app/routes/_dashboard.analytics.tsx` restricts some date ranges to Pro and supports image capture. The new feature has no Pro restriction; image export was not approved as part of this scope.                                                                                                                                                  |
| Global navigation            | `kernel/client/src/modules/shell/sidebar-sections.ts` places kernel views in the shared Saved Views section. Desktop and mobile share navigation data.                                                                                                                                                                                                            |
| Kernel views                 | `kernel/backend/src/modules/definitions/kernel-source.ts` declares All Collections and Calendar; Analytics should follow this definition-owned pattern.                                                                                                                                                                                                           |
| Page composition             | `kernel/backend/src/modules/pages/preparation/README.md`, its `{graph,composition,document,service}.ts` modules, and `packages/contract/src/modules/pages/schemas.ts`. Existing composition owns contributor identity, dependencies, artifact grants and freshness.                                                                                               |
| Client declaration/bootstrap | `packages/contract/src/modules/plugins/manifest.ts`, `packages/plugin-client-sdk/src/bootstrap/composition.ts`, `packages/plugin-client-contract/src/navigation.ts`. There is no analytics-section registration yet.                                                                                                                                              |
| Renderer ownership           | `packages/kernel-renderers/{README.md,src/index.ts}`. Renderers are compiled plugin sources, not kernel-DOM pages. Regenerate sources; do not edit generated text.                                                                                                                                                                                                |
| Media home                   | `plugins/media/shared/activity-recipes.ts` currently aggregates event rows and uses `timeSpent` then `runtime`; it misses type-specific fallbacks used by title recipes. Unknown completions still enter period totals through `occurredAt`.                                                                                                                      |
| Media measures               | `plugins/media/shared/media-recipes.ts`, especially `mediaTimeSpentMeasure`, `mediaEntityCountMeasure`, `mediaFlatConsumptionTotals`; per-type recipe files configure runtime, music `duration / 60`, visual novel `lengthMinutes`, pages, episodes or chapters.                                                                                                  |
| Episodic coverage            | `plugins/media/shared/episodic-recipes.ts`, `episodicScopedCoverageSelection`, measures current coverage. It is not lifetime rewatch consumption.                                                                                                                                                                                                                 |
| Lifecycle                    | `plugins/media/shared/lifecycle-expressions.ts` supplies effective order, parent/episode ownership and cycle expressions. Use logical `(occurredAt, orderCreatedAt, orderKey)` ordering.                                                                                                                                                                          |
| Logging contracts            | `plugins/media/shared/{media-activity-operations,media-activity-fields}.ts`, `manifest/schemas/entity.ts`. Progress currently lacks date/manual-time input and has per-kind property rules.                                                                                                                                                                       |
| Lossy logger                 | `plugins/media/client/media/activity-log/state.ts` converts entered pages to rounded percent. Selected past days become local noon; today becomes submission time. Preserve the actual quantity and precision instead.                                                                                                                                            |
| Runtime writes               | `plugins/media/backend/operations/{media-activity-log,media-activity-update,media-activity-delete}.sandbox.ts`, `media-activity-edits.ts`; imports/integrations converge through `backend/imports/{write-chunks.sandbox,schemas,integration-progress}.ts` where applicable.                                                                                       |
| Write policies               | `kernel/backend/src/modules/events/event-creation.ts` captures entity reference properties and checks them before persistence. Media can use one before-policy to validate/capture consumption facts across ordinary runtime writers. Read automations and user-command protocols first.                                                                          |
| Correction evidence          | `plugins/media/shared/history-correction.ts`, `manifest/schemas/history-correction.ts`, `backend/automations/{history-correction,reconcile-media-history.sandbox,media-history-correction.sandbox}.ts`, `backend/contracts/history-correction-recipes.ts`. Frozen evidence already preserves positional totals and episode inventories for automatic completions. |
| Exact output matching        | `occurrenceProperties`, `occurrenceMatches` and `propertiesMatch` in the correction worker compare automatic output with expected properties. New snapshot fields must not accidentally turn an automatic completion into an explicit override or cause a repair loop.                                                                                            |
| Clear/merge                  | `plugins/media/manifest/user-state.ts` declares child/evidence scope and reset-on-merge behavior. New references must participate in remapping, stale checks, clear and retention.                                                                                                                                                                                |
| AniList distinction          | `plugins/media/shared/list-state.ts`, `backend/integrations/yanks/anilist{,.sandbox}.ts` preserve state snapshots. `backend/imports/anilist.ts` has a separate actual import path; classify each source fact rather than exclude all AniList data.                                                                                                                |
| Fitness totals               | `plugins/fitness/shared/workout-list-recipes.ts` already supplies period totals, comparisons, date buckets and set counts. Extend its canonical expressions.                                                                                                                                                                                                      |
| Fitness records              | `plugins/fitness/shared/workout-records.ts`, `backend/workout-record-step.sandbox.ts`, `backend/automations/{workout-records,workout-set-policy}.sandbox.ts`. Preserve kind-aware volume and record rules and existing freshness behavior.                                                                                                                        |
| Planned rest                 | `plugins/fitness/shared/workout-editor-transformations.ts` resolves `restTime` from explicit choice, exercise override and defaults. `restTimerStartedAt` alone is not actual rest duration.                                                                                                                                                                      |
| Fitness taxonomy             | `plugins/fitness/shared/{home-recipes,taxonomy-recipes}.ts` currently reads live target/equipment links. Recording must capture historical assignments for analytics.                                                                                                                                                                                             |
| Measurements                 | `plugins/fitness/shared/measurement-recipes.ts` and `client/measurements/`. One entry may contain several readings. Current series distinguish missing buckets using counts; retain that behavior.                                                                                                                                                                |
| Projection scope             | `kernel/backend/src/modules/events/README.md`, its `{stream-work,stream-repository,projection-repository}.ts` modules, and `packages/contract/src/modules/events/stream-work.ts`. A stream currently targets one entity and one event schema; output publication enforces that scope.                                                                             |
| Reporting language           | `kernel/backend/src/modules/ryotql/README.md`, `packages/contract/src/modules/ryotql/language.ts`. `dateBucket` supports timezone-aware hour/day/week/month; year and local hour-of-day operations need investigation/extension. The UTC-aligned `timeSeries` operation has since been removed.                                                                   |
| Preferences                  | `packages/contract/src/schema/user-preferences.ts` currently has language and integration-disable preferences, but no reporting timezone. Use the existing validated account preference write owner.                                                                                                                                                              |
| Shared charts                | `packages/plugin-ui-sdk/src/charts.tsx` supplies heatmap, ranked bars, sparkline and measurement-oriented time series. `TimeSeriesChart` uses a separate comparison axis and device-local date formatting; analytics needs same-unit period comparison and explicit reporting timezone.                                                                           |
| Duplicated heatmap           | `plugins/fitness/client/workouts/summary.tsx` contains a separate heatmap. Consolidate equivalent rendering through the shared chart primitives while preserving the metric selected by each view.                                                                                                                                                                |
| V1 conversion                | `apps/server/src/migrations/README.md` and its `{seen-mapping,seen-completion-mapping}.ts` modules. Seen conversion invents intermediate percentages from update timestamps and omits manual time on progress. New analytics must not mistake these for measured consumption.                                                                                     |

### Additional consumer inventory

| Surface                       | Existing consumers                                                                                                                                                                                                                                           | Calculation/use to reconcile                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Media home                    | `plugins/media/client/home/activity-model.ts` (`activityStreak`, `activityShares`), rendered by `plugins/media/client/home/activity-section.tsx`                                                                                                             | Day streak and event-type shares.                                                                               |
| Media library lifecycle       | `plugins/media/shared/library-summary.ts` (`timesCompleted`, `lastCompletedAt`, `lastActivityAt`, average review rating), consumed by `plugins/media/shared/lifecycle-list-recipes.ts`                                                                       | Completion, recency and review summary fields in lifecycle-list projections.                                    |
| Media details                 | `plugins/media/client/media/flat-schema.tsx` (`activityView`); `plugins/media/client/show/schema.tsx` (`showActivityCoverage`, `showPresentationDetail`); `plugins/media/client/podcast/schema.tsx` (`podcastActivityCoverage`, `podcastPresentationDetail`) | Flat-media detail consumption summaries; show/podcast current episode coverage, status and in-progress details. |
| Fitness exercise              | `plugins/fitness/shared/exercise-details-recipes.ts`; `plugins/fitness/client/exercise/history.tsx` and `plugins/fitness/client/exercise/details-model.ts` (`buildStatTiles`, `buildMonthSeries`)                                                            | Exercise history statistics and monthly progress charts.                                                        |
| Fitness workout detail        | `plugins/fitness/client/workout/details-model.ts` (`summarizeWorkout`, `countMuscleSets`, `countEquipment`), rendered by `plugins/fitness/client/workout/overview.tsx`                                                                                       | Single-workout totals and muscle/equipment taxonomy counts.                                                     |
| Fitness workout list and home | `plugins/fitness/client/workouts/model.ts` (`buildWorkoutCards`, `formatTotals`, `groupByWeek`), `plugins/fitness/client/workouts/screen.tsx` and `plugins/fitness/client/home/model.ts`                                                                     | Workout cards, weekly sections/footers and the home weekly streak.                                              |
| Fitness measurements          | `plugins/fitness/client/home/queries.ts`, `plugins/fitness/client/home/measurements-card.tsx`, and `plugins/fitness/client/measurements/model.ts` (`buildMetricRows`, `rollingAverage`, `groupByMonth`)                                                      | Home pinned-measurement trends and measurement history/trend, relative-change and monthly grouping.             |

Equivalent metric calculations must consume canonical definitions and obsolete duplicate paths must
be removed. Keep event-type status summaries, current episodic coverage, elapsed versus active
durations, and detail-relative timestamp formatting semantically distinct. This does not imply a
broad date-formatter refactor.

### Established limits

At research time, RyotQL allows 10 named queries per document, 8 joins per query, 100 root/include
rows, 1,000 grouped aggregate rows or time-series buckets, and correlated depth 3. Grouped aggregates
have `hasMore` but no cursor. Documents execute in one repeatable-read snapshot; a failure fails the
whole document. Separate plugin sections therefore need separate requests/error states.

Event projection steps publish at most 100 updates with a 16 KiB checkpoint. Client compilation has
a 1 MiB combined source/raw-input limit and an independent emitted-artifact limit. Existing history
correction is bounded and resumable. Do not solve capacity problems by raising these limits.

## 3. Metric contract to encode and test

Create domain-owned metric definitions and result schemas before UI-specific queries. Proposed
modules such as `plugins/media/shared/consumption.ts` and plugin `shared/analytics-recipes.ts` are
design locations, not existing APIs. Keep generic range and chart contracts in shared packages.

### Media

- Completion occurrences and distinct completed titles, grouped by all supported media types.
- Movies, music, audiobooks and visual novels: recorded or frozen-estimate minutes.
- Video games: recorded minutes only; community time-to-beat is not consumed time.
- Books/comics: pages. Anime: episodes. Manga: chapters, with separately labelled volume evidence
  where present. Do not invent chapter-to-volume or page-to-time conversions.
- Shows/podcasts: consumed episode occurrences and minutes, plus separate parent title completions.
- Reviews including rating-only records, with target categories identified. Include the supported
  title, child, creator/group and kernel collection review capabilities without counting them twice
  across sections. Collection review metrics remain kernel-owned, not Media-specific kernel logic.
- Active days, daily activity and hourly breakdowns. Distinguish actual consumption observations
  from status/list changes and derived completions; raw event row count is not a consumption metric.
- Known amounts, estimated amounts, missing quantity/date coverage, and processing state.

Examples that must pass:

1. Page 40 → page 70 → completion of a 100-page book: contributions 40 + 30 + 30, one completion.
2. Game time 2h → 5h → 8h in one run: 8h total, not 15h.
3. A first reading outside the selected period still reduces the contribution of a later reading
   inside it. Apply the reporting window after determining the contribution.
4. Duplicate cumulative readings add nothing. A lower new reading adds nothing and does not create
   a repeat. An explicit edit/delete repairs affected later contributions.
5. Full progress and its automatic completion count consumption once. A later independent repeat
   counts again. Existing explicit overrides and deleted automatic-occurrence suppression survive.
6. Episode consumption remains counted when a redundant automatic parent completion is suppressed;
   the same minutes are never counted through both parent and child.
7. Provider runtime/page changes leave previously recorded estimates unchanged, including after a
   rebuild, merge or backup restore.

Test estimation edge cases before selecting the storage algorithm: changing denominators during a
run, first observations with missing metadata, explicit time replacing an estimate, and a corrected
total lower than a prior estimate. Retain original evidence and distinguish an explicit correction
from a provider refresh. Do not create negative consumption or silently fabricate historical data to
make totals fit. Record the chosen allocation algorithm and examples in the Media README.

### Fitness

- Workouts, active days, recorded active duration and missing-duration coverage.
- Sets, repetitions, weight volume, distance and set duration, using recorded exercise kinds and
  existing canonical unit/statistic rules. Weight volume is kg × repetitions, not a sum labelled kg.
- Recorded kcal and **Planned rest**. Do not add set duration or planned rest to workout duration.
- Personal-best awards from current, valid projections. Distinguish award count from count of sets
  with an award; one set may earn several awards. Pending/failed projections must not look like zero.
- Measurement entries and individual readings as separate counts. Per-metric trends and changes
  retain their own units; missing readings are gaps, while a recorded zero is valid.
- Exercise, muscle and equipment rankings from retained workout evidence. Label whether a ranking
  counts sets, exercise occurrences or distinct workouts. Reuse existing primary/secondary/stabilizer
  weighting when presenting the existing muscle-set metric; do not silently redefine it as frequency.
- Workout-period totals follow the existing workout-start attribution. Hourly labels identify whether
  they show workout starts or timed set observations; an imported fallback timestamp is not evidence
  that every set was performed at that hour.

Keep unrelated quantities separate. A unified page does not require one cross-domain grand count or
adding concurrent activities into a claim about elapsed real-world time.

## 4. Source facts, capture and correction

### 4.1 Canonical Media recording

Refactor the existing logger, operations and source adapters together:

1. Preserve exact entered amounts and units. Normalize through one canonical progress representation;
   derive presentation percentages where possible. Do not retain independently editable duplicate
   amount/percent fields or old aliases. Percent-only source evidence with an unknown denominator
   must remain representable without inventing a quantity.
2. Preserve observation precision and calendar date separately from the timestamp required for
   deterministic event ordering. Replace the current date-only-to-noon attribution path.
3. Retain a bounded estimation basis with unit, available source amount and provenance distinguishing
   recorded quantities from metadata estimates. The exact property names are implementation details.
4. Add date and cumulative-time controls to the existing progress form, including history editing.
   Reuse shared date/time validation and the immutable background-submission envelope.
5. Use one Media before-policy across ordinary event writers to validate/capture facts. Account for
   direct API, manual operations, automatic consequences, generic imports and integration chunks.
6. Preserve evidence on unrelated edits and replay. Update stale-write snapshots and declared field
   allow-lists. Frozen automatic completion evidence must not be recaptured from current providers.
7. Update the correction worker's expected-output construction and comparison for the new facts.
   Nested snapshot values need appropriate structural comparison; shallow object identity is not
   sufficient. Keep derived corrections silent.

Runtime policies are not the historical restore path. Backups preserve the facts, and V1 conversion
constructs the canonical facts explicitly. Do not replay current notification/integration hooks to
populate historical estimates.

### 4.2 Fitness taxonomy capture

Capture the applicable target/equipment identities and roles for each recorded exercise occurrence,
with bounded storage and typed references. Avoid copying an unbounded taxonomy on every set. Reuse
that evidence for all historical rankings and muscle activity views that report performed work.

Update workout creation, historical editing, imports and V1 conversion. Unrelated edits retain the
snapshot; newly recorded occurrences capture their applicable assignments. Preserve source kind and
units. Make typed references participate in backup dependency discovery, restore remapping, exercise
merge, explicit deletion and provider-graph retention. Template plans do not establish performed work.

### 4.3 Reporting timezone

Extend validated account preferences and the settings UI. Initialize an unset preference from the
device's named timezone through the normal preference write path, with UTC as the deterministic
fallback when a usable zone is unavailable. Background/migration work cannot guess a device zone.
Provide the effective preference to plugin reporting through the existing authenticated context or a
narrow shared capability; do not expose the kernel-only user table to plugins just for this setting.

Use the same timezone in query boundaries, bucket keys, axes, tooltips, home summaries and comparisons.
Retain ordinary ownership/demo checks. Preserve the preference in account backup/restore. Date-only
source values remain dates when the reporting timezone changes.

## 5. Query and storage gate

Implement the canonical calculation over current source facts and retained correction evidence first.
Reuse lifecycle ordering/cycle semantics. Prototype the difficult cases before the full screen:

- Cross-period cumulative progress and repeated cycles.
- Full progress plus explicit/automatic completion and overrides.
- Historical snapshots with different units or missing values.
- Long episode histories, many independent titles, and all-time grouping.

The original plan called for measuring generated query shape, plans, latency and result size using the
available dumps and synthetic large histories, reporting timings and fixture sizes, and agreeing a
concrete performance target at this gate. It did not claim that direct queries already met a target.

The originally approved local query benchmark guidance was warm-query p95 ≤500 ms for normal period
reports and ≤2 seconds for all-time reports over 100,000 recorded observations per account. These
remain historical guidance, not current release blockers; see the owner decision below. Record fixture
sizes, query plans, cold timings and slower real-dump cases separately. They are not achieved p95 results.

On 2026-10-29, the owner accepted the current Media query speed as adequate for the current
implementation and waived the former warm-p95 targets as release blockers. The latest normal-period
single diagnostic was 946.445084 ms and the all-time single diagnostic was 2,591.592 ms. Neither is a
p95, and no complete 20-warm-sample acceptance run was captured. This decision does not claim a p95
pass or change correctness, readiness, or other acceptance gates.

If direct queries fit existing limits and perform adequately, use them as the one production path.
If measured query/scale limits require derived per-event contributions, extend the existing event
projection system rather than add a second analytics worker/cache framework:

- Declare the actual related input event schemas and scope.
- Invalidate on all inputs, including edits/deletes, reference moves and relevant correction changes.
- Fence publication on the complete dependency revision, not just the output event's existing stream.
- Preserve bounded steps/checkpoints, restart/retry, exact plugin binding and account-generation rules.
- Keep output separate from source facts, and hide stale values through the canonical freshness path.
- Rebuild after restore and declaration changes; remove replaced declarations/APIs rather than keep
  two equivalent projection entry points.
- Account for the effect on Fitness's existing single-schema processor and its tests.

The existing single-schema stream is not sufficient merely because its processor can query sibling
events. Both invalidation and publication scope need a real design. Make this decision early, record
the evidence, and remove the unused prototype path. Do not add daily/monthly rollup tables without
separate demonstrated need.

## 6. Global page and plugin contribution contract

Proposed implementation shape:

1. Add a declarative analytics component registration to the client manifest, with stable identity,
   display metadata and a referenced component export. Validate the export and owner at ingestion.
2. Add the kernel `analytics` saved-view definition and renderer. Reuse global saved-view navigation,
   customization, command-center search, page preparation and document hosting.
3. Extend composition identity/descriptors, contributor resolution, import maps, stylesheet loading
   and SDK bootstrap to load registered sections. Reuse the existing composition graph, including
   private dependencies and exact installation identity. Do not hard-code Media/Fitness packages.
4. Pass a typed, environment-neutral reporting selection to each section. Plugins own queries,
   metric vocabulary, section contents and drill-down. The renderer owns one page title, chrome,
   reporting controls and section navigation.
5. Bound concurrent queries and isolate loading/error/retry per section. Handle zero/one contributor,
   missing artifacts, unavailable installations, catalog changes and explicit page reload/freshness.
6. Preserve shared-realm and iframe trust rules. Keep capabilities contributor-scoped. Visibility and
   readiness determine executable sections; a hidden navigation item must not invalidate history.

Use a generic fixture plugin to prove the registration is product-agnostic. Extend existing SDK and
compiler surfaces instead of bypassing them with authored dynamic imports or a new iframe host.
Rebuild the shared runtime, kernel renderer sources, plugin artifacts and server image together.

## 7. Reporting controls and recipes

- Support useful rolling/calendar ranges, custom dates and all time; current-versus-previous-period
  comparisons; automatic or explicit day/week/month/year grouping.
- Keep the selection in URL state so refresh, direct links and Back reproduce the report. Reuse the
  canonical saved-view location update path and test it for analytics search parameters.
- Key rolling queries by stable selections. Compute moving boundaries from the supplied schedule
  clock during execution, not from a timestamp embedded in the cache key.
- Use half-open instant ranges and calendar-aware local boundaries. Cover DST gaps/repeated hours,
  leap days and unequal calendar month lengths. Comparison labels must describe the actual ranges.
- Previous zero with a positive current value shows an absolute change/new activity, not infinity.
  Missing values never become a confident percentage change.
- Extend generic RyotQL date support where required for years and timezone-aware hour-of-day
  aggregation. Update schemas, builders, validation, compilation and tests together. Do not load all
  hourly history into the browser to derive 24 buckets.
- Use timezone-aware grouped aggregates for multi-measure charts and lay them onto the client
  `calendarBuckets` grid; the removed UTC-aligned `timeSeries` could not supply local boundaries.
- Plan query partitioning within 10 named queries and 1,000 grouped results. Multiple media types
  multiply group counts. Coarsen or partition long ranges and handle `hasMore` explicitly.
- Rankings may show a bounded top list with a complete paged drill-down. Grouped aggregates have no
  cursor; use an appropriate root-row recipe for full ranked browsing rather than fake pagination.
- Reuse shared SDK pagination for contributing events, workouts and readings. Preserve loaded results
  on refresh and distinguish next-page loading from background fetching.

Refactor `mediaActivityRecipe`, flat consumption totals, workout summaries, measurement charts and
equivalent home cards to consume the canonical definitions. Keep source status/coverage UI where it
has different semantics, with explicit labels.

## 8. Chart design and dependency decision

The owner specifically wants good-looking graphs and permits new dependencies **after discussion**.
Start with `@tanstack/charts` (the researched UI SDK pins `0.18.0`) behind `plugin-ui-sdk/charts`.
Current upstream documentation was checked during planning for responsive rendering, shared
pointer/keyboard focus, tooltips and reduced-motion support. Verify APIs against the installed
version during implementation; planning did not validate a working prototype.

Visual direction:

- Clear visual hierarchy: summary figures and comparison captions, then a primary trend, followed by
  compact breakdowns. Use existing theme tokens, spacing and typography.
- Same-unit period comparisons use the same axis, with distinct solid/dashed styling and explicit
  legends. Avoid misleading dual axes for the same metric.
- Consistent category colors; restrained area fills; readable unit/date labels; no smoothing that
  invents activity between discrete count buckets.
- Horizontal ranking bars, calendar consistency heatmaps and a 24-hour activity histogram.
- Measurement trends retain raw observations, visible gaps and clearly labelled smoothing.
- Tooltips show exact values, period, units and estimate/missing-data context. Keyboard and tap
  inspection must work inside the real sandboxed iframe.
- Drill-down to contributing records and an accessible exact-value table/text representation.
- Responsive tick density, wrapping legends and sufficient touch targets. Use bridged compact and
  safe-area values. Test light/dark and reduced motion; preserve stable layout during refresh.
- Empty, single-point, all-zero, missing-only, pending and failed states are designed states.

Build a representative trend/comparison chart and hourly chart early. Inspect them at mobile and
desktop sizes in the actual host. Extend the shared wrappers and consolidate the equivalent Fitness
heatmap. If a concrete limitation requires another library, explain the limitation, bundle/runtime
cost and replacement scope to the owner before adding it. Keep one shared chart implementation for
equivalent uses, including existing screens. No dependency change has been approved by name.

## 9. V1 conversion, backups and retention

Read the migration runbook and preserve its legacy exception and restart rules.

- Capture estimates from available V1 metadata before legacy tables are dropped, including metadata
  whose corresponding V2 provider entity intentionally starts as a skeleton.
- Retain available manual time, units, source identity and honest date precision.
- Replace invented intermediate amounts from `seen.updated_at` interpolation with defensible source
  evidence. Audit lifecycle/completion conversion together so removing fabricated measurements does
  not create a different completion cycle or discard a real explicit occurrence.
- A source update timestamp alone is not a consumption date. Report undated cumulative baselines
  without attributing them to migration day. Do not infer hour precision from a manufactured time.
- Capture Fitness taxonomy from available legacy assignments and document that provenance.
- Produce the new schemas directly. No compatibility runtime for earlier V2 development data.
- Preserve snapshots and typed references through export/restore. Rebuild derived contributions
  through existing reconciliation, preserving source order, explicit overrides and suppression.
- Include new evidence in user-data removal/merge and provider-graph retention. Do not pin abandoned
  metadata forever through obsolete temporary calculation state.
- Migration-only execution stays silent and creates no automation notification history. Preserve
  deterministic identities and restart-safe phase reports.

Real-dump validation uses **both `tmp/file.sql` and `tmp/file2.sql`**, which were present during
research, in disposable PostgreSQL/Redis/object-storage resources. Rebuild the shipped archives and
server assembly first. Follow `apps/server/src/migrations/README.md`; do not run its destructive
restore helpers against the working services.

Compare source-supported totals, dates, manual values and taxonomy against migrated facts, then run
normal startup and await derived work. Restart and compare again. Inspect anomalies explicitly.
Record query plans/timings on the largest enabled histories, and verify disabled accounts do not
unexpectedly run plugin work. Generated SQL tests and normal e2e do not replace these gates.

## 10. Implementation sequence and exit gates

| Step | Work                                                                                                                                                    | Exit gate                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1    | Recheck current tree; encode approved metric/date/quantity contracts and examples. Inventory all writers/consumers and legacy mappings.                 | No undefined metric meaning; source/evidence ownership is explicit.                                           |
| 2    | Canonical Media facts, logger/update controls, snapshot policy and correction integration; Fitness taxonomy capture; reporting timezone preference.     | Manual/API/import/integration paths produce consistent facts; retries and unrelated edits preserve snapshots. |
| 3    | Direct-query correctness and scale prototype; decide whether existing projections need extension. Build representative chart prototype.                 | Measured read/repair approach selected; chart interaction/layout validated; unused prototype removed.         |
| 4    | Analytics contribution contract, global saved view, composition/SDK/renderer integration.                                                               | Generic fixture contribution, ownership, freshness and independent failure behavior pass.                     |
| 5    | First usable slice: Media consumption totals and Fitness/workout/measurement totals. Migrate equivalent existing calculations.                          | Analytics, home and detail totals agree for equivalent scope.                                                 |
| 6    | Period comparisons, grouping, trends and measurement views.                                                                                             | Timezone/DST/date precision and missing-data behavior pass.                                                   |
| 7    | Hourly charts, frequency rankings and paged drill-down; visual refinement.                                                                              | Complete responsive screen with accessible interaction and no silent truncation.                              |
| 8    | Complete V1 conversion and backup/merge/removal/retention acceptance. Prepare migration changes alongside earlier schema work, not as a late discovery. | Both real dumps and restart pass; retained facts survive provider refresh and restore.                        |
| 9    | Affected checks/tests, review fixes, required cleanup, final repository validation and documentation.                                                   | Results recorded; only then mark Order 16 Done.                                                               |

The early chart prototype and query feasibility gate may proceed independently once metric examples
are defined. Do not build the entire screen before proving the historical calculation path.

## 11. Validation and completion

### Behavioral tests

- Exact amounts, percent-only evidence, missing/zero values, rounding and unit conversions.
- Cumulative progress across date windows, repeated readings, lower readings, runs and rewatches.
- Explicit versus derived completions, tied timestamps, automatic suppression, edits and deletes.
- Parent/child double-count prevention, specials, large episode inventories and detached historical
  children retained by correction evidence.
- Provider metadata/taxonomy refresh, changed denominators, explicit manual-time corrections and
  retries after metadata changes.
- Date-only/unknown/instant inputs, imported undated baselines, list-state exclusion, DST, leap days,
  timezone changes, previous-period zero and missing comparison data.
- Workout edits/deletion, incomplete derived work, multiple personal-best awards, unknown active
  duration, planned-rest labels and historical taxonomy preservation.
- Measurement entries with multiple readings, custom units, actual zero values and missing buckets.
- Cross-user/plugin isolation, private/system identity, unavailable contributors and independent errors.
- Backup/restore, merge, clear and retention for source facts and any typed evidence references.
- If projections change: all dependency invalidations, concurrent stale publication, bounded restart,
  retry-after-failure, plugin binding changes and account retirement.

### Browser/API acceptance

Add focused suites under the existing kernel/plugin e2e ownership paths. Cover the new page from
sidebar/drawer and command center, shared filters and URL/Back restoration, home links, log/edit then
analytics agreement, drill-down, timezone preferences and independent plugin failures.

Inspect charts in the actual iframe at compact and desktop sizes, in light/dark themes. Check hover,
tap, keyboard navigation, tooltips, legends, units, reduced motion, exact-value alternatives, empty
states and pending/failure recovery. Build both shipped plugins, shared client runtime, kernel
renderers and client so compiler and artifact limits are exercised.

### Required command order

For each affected package group, run root-level Turbo checks before its tests, without passthrough
arguments for non-e2e validation. For example:

```bash
bun turbo --filter=@ryot-app/media-plugin --filter=@ryot-app/fitness-plugin check
bun turbo --filter=@ryot-app/media-plugin --filter=@ryot-app/fitness-plugin test
```

Include all affected contract, SDK, compiler, renderer, RyotQL, kernel and server packages as work
progresses. Run only affected e2e files using the documented harness command:

```bash
bun turbo --filter=@ryot-app/e2e test --only -- '<affected-file>'
```

Review only after affected checks/tests pass; reviews are read-only. Address findings, then execute
the repository's `.agents/skills/codebase-cleanup` in the main implementation session. Use current
repository instructions if the skill location changes. Do not keep old calculation helpers, SDK
aliases, temporary benchmark code or duplicate chart implementations after consolidation.

At the end, run in this order:

```bash
bun run check
bun turbo --filter='!@ryot-app/e2e' test
```

Do not force cache reruns, increase limits/timeouts or run the whole e2e suite to hide failures.
Record affected package/e2e results, real-dump and performance evidence, visual acceptance and final
repository results in the handoff.

Update Media/Fitness and shared architecture READMEs where behavior changes, add maintained user
documentation in `apps/docs`, and record the approved exclusions and Order 16 acceptance in the gap
analysis. Order 16 remains In progress until the complete usable screen and all remaining gates pass.

## Implementation evidence before the follow-up redesign — 2026-10-29

### Latest checkpoint

#### Current status — 2026-10-30 (replacement-environment run)

At this checkpoint Order 16 was in progress only for real-dump normal-runtime readiness, which the
owner moved to a VM. The follow-up redesign has since changed these sources, so this evidence does
not validate the current code.

- **Base.** Runs used `60844dfb4b` (after the `[schema-sync]` commits) plus the kernel events change
  below. Migrations ran from an isolated worktree with clean environments and the documented
  `order16_run` parameters; build passed 8/8 tasks and assembly passed.
- **E2E.** All 18 Order 16 files pass serially, one Turbo run each (73 tests, no cache replays):
  Media API recipes 4/4, with entity ranking in 167.0 seconds under the unchanged 180-second budget;
  Media paging 1/1; Home links 2/2; Media browser 2/2; Fitness browser 1/1; Fitness interactions 2/2;
  Analytics 3/3; reporting charts 1/1; reporting preferences 1/1; contributions 4/4; user settings
  6/6; backup round trip 8/8; Fitness evidence 7/7; consumption 4/4; consumption retention 3/3;
  activity writers 13/13; imports 2/2; integrations 5/5. The earlier ranking timeout no longer
  reproduces; no fixture, timeout, writer or assertion changed.
- **file migration.** Migration-only exited 0 in 80 seconds. Exact comparison passes for every
  canonical record (66,188 Media, 52,926 Fitness, 2,090 evidence, 35 parent; zero missing, changed or
  extra); manual minutes 1,847/1,847. Persisted-schema validation passes 121,239/121,239. Silence,
  event-group and foreign-key gates pass. All 43 original assets pass byte/owner proof. Migration-only
  restart exits 0 and leaves events, reports, details and schemas unchanged.
- **file2 migration.** Migration-only exited 0 in 9 minutes 26 seconds. Exact comparison passes for
  every canonical record (628,797 Media, 15,746 Fitness, 287,659 evidence, 5,322 parent; 25,978
  documented omissions); manual minutes 404,219/404,219. Schema validation passes 937,524/937,524.
  Silence, group and foreign-key gates pass. Asset verification reports exactly the 107 waived
  unavailable originals and no other failure. Restart stability passes with zero differences.
- **Normal-runtime stall fixed.** On real history, startup never became ready. Projection readiness
  rederived every required target from the account's entire history on each relationship-projection
  step while holding the account's input lock (5 seconds standalone, up to 15 minutes under load).
  Discovery rederived all accounts' targets once per 100 streams. After 40 minutes, file had 267 of
  119,260 streams. Readiness now checks existing streams first and derives the full relation only when
  they are all ready. Discovery derives each enabled account's missing targets once and seeds pages of 100. Mapping fanout reads only the source users' mapping events. Readiness semantics are unchanged.
  Focused backend tests pass 66/66 and the kernel backend check passes.
- **Remaining throughput limit.** With the fix, file reconciliation progressed steadily (5,768 streams
  in about 25 minutes) but slowly. Media hosts every history-correction event on the account's Media
  Library entity, and source-reference locks (`FOR NO KEY UPDATE`) plus that entity's scope revision
  serialize all correction writes for one account. Sampling showed nearly every active connection
  waiting on that entity row. One-time catch-up after migrating a 60,000-title account is estimated at
  10–16 hours. Ordinary single-title writes recompute only that title in seconds, and different
  accounts do not block each other. The owner kept this design. Redesigning correction storage or the
  kernel lock protocol remains out of scope.
- **Pending on the VM.** The owner stopped local runtimes on this development machine and will deploy
  this commit to a VM. Approximately 15 hours later, verify: enabled event and relationship projections
  ready with zero pending/failed work; disabled accounts ran no plugin work; strict live Media/Fitness
  comparisons against source expectations; and stopped-runtime stability of source facts and reports.
  Use the kit's `gates.py runtime` and `accept.py runtime-stability` checks, or equivalent SQL, against
  the VM databases. Mark Order 16 Done only after these pass.

Evidence is under `order16-runtime/claude-20261030-01/` in the approved temporary directory. Kit
captures used the replacement kit `order16-acceptance-kit/recreated-20261030-1gh3vrcc/`. Local
targets keep their migrated data with containers stopped; nothing was deleted.

#### Prior status — 2026-10-30 (morning)

Order 16 remains **IN PROGRESS**. Post-cleanup acceptance is blocked at Media API 3/4: entity ranking
exceeds the unchanged 180-second budget. The later post-cleanup browser files, build/freeze, fresh
expectations, and both replacement-target migrations/runtime proofs have not run. The owner declined
broader runtime investigation and requested documentation plus an `o16` checkpoint commit. Investigation,
E2E retries, build/freeze, and migrations are stopped. Repository-wide checkpoint validation passes:
`bun run check` (52 boundary-rule tests; 38/38 Turbo tasks, 33 cached), followed by
`bun turbo --filter='!@ryot-app/e2e' test` (51/51 tasks, 48 cached). Full logs are under
`order16-checkpoint-validation-rl4l1ez2/` in the approved temporary directory. These results do not
supersede the E2E blocker or prove migration acceptance. No push is requested; this checkpoint does
not mark Order 16 complete.
The checkout advanced through other work during the pause; this session preserves those commits.
The proven factored discovery helper
is already present and differs from its private proof input only in SQL indentation. The stale
account-generation fixture is also corrected. Current affected checks pass 34/34; backend tests pass
3,023 across 352 files (40/40 tasks, 35 cached), including early preparation and queued coalescing.
Latest Media tests pass 1,914 across 256 files (46/46 tasks, 42 cached); Fitness remains 675 tests
across 102 files from the prior 47/47-task domain run. These package results supersede earlier
incomplete confirmations.

The former Order16 containers are no longer available in either configured Docker context. Dumps,
immutable SQLite captures, proof logs, and the file1 asset cache remain. The user approved a fresh
isolated environment from those originals, preserving all earlier evidence. New PostgreSQL, Redis,
and object storage are running; both fresh legacy target clones match their restored source table
counts. Both buckets contain 58 cached objects (284,336,460 bytes); all 43 file1 originals pass byte,
size, and content-type verification. Read-only recapture of both restored sources matches every
retained source fingerprint exactly.
No replacement-target migration, normal startup, or live metric pass is claimed. Earlier
file1 exact/schema/asset/restart results remain historical, not replacement-environment acceptance.
File2's 107 unavailable originals remain waived only as an asset-verification acceptance blocker;
all other data and runtime gates must pass. The user paused the other E2E runner. Media browser
baseline passes 2/2, and four trend images are readable and unclipped. Additional hour/calendar
captures are prepared. An earlier normal Media API run passed **4/4**, including exact 102-record
source paging and 102-entity ranking through real 100+2 cursor pages. Entity ranking passes in
176.104 seconds with original 50-item batches and the unchanged 180-second budget. The queue then
stopped at browser paging: its exact first-page date labels differed only between Bun and Chromium
Intl punctuation. The expectation now formats public source instants in Chromium, retaining exact
timestamps, source identity, facts, quantities, row contents, and cursor assertions. The corrected
browser paging case now passes 1/1 (88.547 seconds), including 100 initial rows and all 102 rows after
the real Show more action. Home links now pass 2/2 after scoping timezone text to Analytics controls
and scrolling the stable Media Home container instead of its replaceable lazy placeholder. The current
Fitness interaction file now passes 2/2 after fixing a 482-pixel plot in a 390-pixel viewport. The tab
panel can shrink, and the selected metric label is bounded without losing its accessible text.
The fresh 326×200 compact plot is readable and unclipped; full-plot visibility and both horizontal
overflow checks pass. Fitness package tests pass 675/675 across 102 files (46/46 tasks, 42 cached),
and affected checks pass 34/34. Backup round-trip acceptance passes 8/8. The activity writer file
stopped at 12/13 on an obsolete empty-properties expectation: on-hold and dropped events retain exact
canonical bases. Its test now checks those bases and still rejects extra progress quantities; no
writer behavior changed. Its rerun passes 13/13; imports pass 2/2 and integrations pass 5/5. All eight
focused files have passing evidence across serialized runs (37 tests), not one coordinated-freeze run;
the later post-cleanup API timeout supersedes the earlier API pass as the current blocker. Evidence is under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-e2e-sequence-20261030-hgabnbmm/`.
Additional Media and post-diagnostic Fitness files pass 2/2 each with all 5,191 tracked paths
unchanged before and after both files. Their twelve Media captures and latest 326×200 Fitness plot
are inspected: trends/hours are readable and unclipped. Calendar image-only captures omitted labels;
the capture target now includes the Daily consistency card, without product or assertion changes.
The affected Media file passes 2/2 with unchanged tracked sources; all four contextual calendar cards
are readable, including window dates, month labels, legend, controls, and exact-value disclosure.
Evidence is under `order16-final-browser-captures-682muwom/` and
`order16-final-browser-captures-wojg8bby/` in the approved temporary directory.
The corrected read-only pre-freeze infrastructure probe passes for all three services, both unused
legacy targets, source-count anchors, and free startup ports. Its evidence is under
`order16-pre-freeze-infra-bmlws2hq/`; the prior probe's absent-health-field template error remains
retained, not a storage failure. These are preconditions, not migration/runtime acceptance.
Main-session cleanup from checkpoint `1bcff025ba` removes 180 net lines of temporary fixture stage,
identity, and failure-snapshot diagnostics. Real writers, canonical readiness, assertions, and account
teardown remain; all historical logs/images/proofs are preserved. The three affected Media files
require post-cleanup serialized confirmation before coordinated build/freeze.
The first post-cleanup API confirmation stopped at 3/4: entity ranking exceeded the unchanged
180-second budget (181.601 seconds including teardown). All 5,191 tracked paths stayed unchanged;
the two later browser files did not run. Evidence is under
`order16-final-browser-captures-55q01yja/` in the approved temporary directory. The earlier 176.104-second
pass is retained, not treated as sufficient margin. Reusing the resolved Book schema removed 101
redundant admin plugin lookups but did not resolve the gate: its API confirmation remains 3/4, with
ranking timing out (185.687 seconds including teardown). All tracked sources stayed unchanged, and
the browser files did not run. Evidence is under `order16-final-browser-captures-xuvvj_tj/`. That
unsuccessful fixture change is removed. Original seeding, concurrency 2, all 101 additions, 50-item
batches, real writers, readiness, exact totals, cursor assertions, and budgets remain unchanged.
Retained passing/failing span comparison is under `order16-cleanup-ranking-spans-wue2s4ry/`; it finds
no PostgreSQL errors or deadlocks, but summed concurrent spans are not causal-stage timing. No further
fixture tuning or generic runtime change is justified by that aggregate alone. The owner declined
broader runtime-cost diagnosis and requested this checkpoint. Restored-fixture checks pass 34/34
(31 cached), with evidence under `order16-restored-fixture-check-u2bziq2m/`. No build, freeze, expectation
regeneration, or replacement-target execution has started.

Resume only with new owner approval: resolve the ranking budget without changing canonical calculations,
writers, timeouts, or readiness/pagination assertions; confirm the three affected files serially; build
and freeze actual current sources and artifacts, including tracked documentation; regenerate guarded
expectations; then complete file1 and file2 migration, exact/schema/silence/group/restart, normal automatic
recovery/readiness, strict live comparisons, and stopped-runtime stability. Reconcile documentation only
after the guarded runs. File2's 107 unavailable originals remain unverified; apply the conditional overall
waiver only after every other gate passes. Interrupted-migration experiments remain separately unapproved.
Completed API and initial browser logs are under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-e2e-sequence-20261030-02zgonru/`.
Passing browser paging and failed Home-link logs are under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-e2e-sequence-20261030-xnitqw0q/`.
Passing Home-link and failed Fitness visibility logs are under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-e2e-sequence-20261030-weu29ym0/`.
Passing Fitness and compact-image evidence is under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-e2e-sequence-20261030-skbi1w1n/`,
with image `fitness-analytics-measurement-992123a8-9ff4-4f18-a748-af9f888038dc-compact.png` in the approved
temporary directory. The same run retains the 8/8 backup pass and prior 12/13 writer result.
The later resumed writer/import/integration passes supersede that failed writer expectation.

The earlier source-write diagnostic passed 3/4: totals/trends and the 102-Anime
source cursor pass (91.868 seconds); entity ranking times out before cursor assertions. It retained
32 read-only snapshots without observer errors; HEAD `1bcff025ba` and ten observed source hashes
stayed unchanged. Evidence is under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-observed-media-sources-1v_ca21j/`.
The prior observed post-coalescing API run also passed 3/4: totals/trends and
the 102-Anime source cursor pass (112.503 seconds); entity ranking still times out before its cursor
assertions, with 50 Book pending. It retained 34 read-only snapshots with no observer errors; HEAD
and all six observed source hashes stayed unchanged. Evidence is under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-observed-media-api-cni7iope/`.
The prior pre-coalescing isolated run also passed 3/4: totals/trends passed, and the
102-Anime source-cursor case passed in 119.015 seconds with 100+2 real cursor pages and exact order,
filters, contributions, and independent occurrences unchanged. The 101-entity ranking case timed out
in 189.134 seconds with 50 Book pending before its cursor assertion. The exclusive queue stopped at
index 0; the remaining seven files did not run, and the other E2E runner remains user-paused.

Prior pre-coalescing evidence (`api.log`, `0.snapshot.private.json`, summary, and identity) is under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-stale-projection-api-diagnosis-20261030-ydki1k0n/`.
Its truncated 100-row sample has `hasMore: true`: 50 running and 18 queued user-work rows, 17 running
and 15 queued projection rows, 50 scopes, and zero errors.

**Prior coherent API failure (historical; superseded by the latest isolated 3/4 run).** The earlier
serialized run stopped at index 0: totals/trends passed 2/4; both cursor cases timed out before their
respective cursor assertions; the other seven files did not run. Its truncated snapshots were not
full queue counts. Snapshot 0 showed 100 event-projection items (99 queued, 1 running), one entity
scope, and 102 Anime pending. Snapshot 1 showed 50 running and 5 queued user-work items, plus 16
running and 29 queued event-projection items, with 50 Book pending. Neither sample had errors, and
work paging reported `hasMore: true`. Retained server/PostgreSQL logs showed no DB ERROR or deadlock;
the then-parent aggregate of 1,025 processes versus 118 publishes suggested stale-work execution.
That interval also contained 195 processor completions and claim checks without publication:
superseded jobs ran before the publication fence rejected them. The interim persisted-claim check
skipped those scripts while retaining settlement, recovery, and handoff; publication fencing was
unchanged. That private evidence remains under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-e2e-sequence-20261030-48q9tz1e/`.

Prior retained log spans show 428 projection processes and 331 publishes, versus the earlier
1,025/118, plus 2,026 prepare-guard spans. In the last minute there were 656 projection reservations,
524 prepare spans, 19 process spans, and 11 publish spans. These are spans, not unique jobs; do not
derive an exact false-guard count from them. Temporary shared physical-entity-row blocking clears;
those logs showed no PostgreSQL errors or deadlocks, but logical shared-library identity was then
unproven. The later diagnosis below supersedes that observation.

Atomic queued-work coalescing is implemented through the existing background-work owner. It
selects only queued obsolete work for the exact stream/account/user/plugin/scope, excludes the
current claim, locks rows in canonical-ID order, and caps a batch at 100. Running jobs, current
claims, and user-work are unchanged. `background.settle` and reference release occur inside the
admission transaction; publication fencing is unchanged. Coalescing checks pass 34/34 and backend
tests pass 3,023/3,023. One new regression initially used a different authority, correctly triggering
rebinding; it now derives the same projection authority. The observed post-coalescing API run
remains 3/4, so full acceptance is not claimed. Its truncated 100-row failure sample shows 50
running and 17 queued user-work rows, plus 13 running and 20 queued projections, with no errors
and `hasMore: true`. At that point, the retained job, repair-phase, and lock-identity snapshots
awaited diagnosis; see the later diagnosis below.

Latest diagnosis from `/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-observed-media-api-cni7iope/`:
snapshots 22–33 before the 03:50:57.299 UTC failure show each of the first 50 Book corrections
retaining one running silent worker, one stable request key, two run keys, `force=false`, and
`conflictAttempt=0`; each restarted exactly once from `sourceRevision=1` to `2`, and none finished
the second pass before failure. Ordinary workers were queued with distinct request/work keys, not
concurrent writers of the same state. Uncapped snapshot 33 has 271 active jobs: 50 running silent,
20 queued ordinary, 47 running projections, and 154 queued projections. Every queued projection is
current; six running claims are stale, so the earlier obsolete-queued-backlog explanation does not
apply. Root tuples prove a shared logical lock on one Media Library entity. Its 565 conditional
logged acquisitions averaged 915 ms, with a 2.734 s maximum; these are not p95 or population
latency, and no deadlock was observed. Only 50 of 101 new Book source events were written; 51
remained absent in that run. Warning correlation alone did not identify the revision-2 source write.
The prior test identity remains valid: HEAD `f497` and six source hashes were unchanged, and the test
finished before commit `1bcff025ba`.

The later source-write diagnostic identifies the legitimate second input: all first 50 Books have
only their unchanged `complete` event at scope revision 1 in snapshot 19, then an additional
`add-to-media-library` event at scope revision 2 in snapshot 20. Neither event is edited. The
membership-recording hook creates the event on the Book, so `EventsRepository.touchScopes` advances
the guarded revision; library checkpoint writes alone were not the cause. The retained aggregate
proof passes 22/22 evidence assertions under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-membership-revision-proof-tax_cy3a/`.
All first 50 corrections
reach `done` at revision 2 by snapshot 29. The next 50 source writes then arrive; the failure has
78 Book sources pending, so this run does not prove the earlier first-wave timing is deterministic.
No further generic scheduler change is justified. Ten-Book fixture backpressure passed affected checks
34/34 (28 cached), but its API run remained 3/4: 40 Books settled before the unchanged 180-second
budget expired, with 10 more pending. It retained 31 error-free read-only snapshots and unchanged
HEAD/ten observed source hashes under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-observed-media-sources-8v_w7byy/`.
The unsuccessful fixture change is removed; all original 101 additions and 50-item write batches remain.

A Media-owned fast path is now implemented for fresh flat corrections with no progress, completion
occurrences, temporary coverage, or missing dependencies. It writes one guarded `done` checkpoint
instead of empty audit/progress/prune/clear checkpoints. Source baselines, per-record guards,
publication gates, real writers, and canonical calculations are unchanged. Progress/evidence and
episodic corrections keep the paged state machine. Affected checks pass 34/34 (29 cached), and Media
tests pass 1,914/1,914 across 256 files (46/46 tasks, 42 cached), including seven added fast-path and
exclusion cases. The original 50-item fixture's fast-path run remained 3/4, retaining 30 error-free
snapshots and unchanged HEAD/12 observed source hashes under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-observed-media-sources-8ufh8bgj/`.
All 101 Book sources were written and reached `done` at revision 2; the post-timeout failure capture
shows canonical `ready` with zero pending/failed sources, not on-time acceptance. The continued test
also reached the first ranking assertion and exposed locale-based expected ID ordering versus the
query's byte ordering. That expectation now compares IDs directly, without weakening exact order.
The aggregate proof is retained under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-flat-ranking-proof-jzihu7nj/`.
Ten-item batches with the fast path still remained 3/4: 90 Books settled and 100 were written before
failure, with 11 Book sources pending. The last addition had not been written. Evidence is under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-observed-media-sources-wopgh266/`.
It retained 30 snapshots and unchanged HEAD/12 source hashes; a later capture failed because teardown
had already stopped its pinned container. That observer error is retained, not counted as clean
observation. The normal 25-item backpressure run also stopped at index 0 with API 3/4 and 16 Book
sources pending; no remaining file ran. Its full log is retained under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-e2e-sequence-20261030-l2oxocgn/`.
Backpressure is removed again. The successful normal API run retains the fast path and exact-order
fix with the original 50-item batches and one final correction wait, without the diagnostic observer.
All 101 additions, real writers, readiness, exact totals, 100+2 cursor assertions, and the 180-second
budget remain. Checks pass 34/34 (31 cached). That queue passed API 4/4, then stopped at browser paging
on the Intl label difference described above. Corrected browser paging, Home links, and the new
Fitness measurement visual gate, backup, writer, import, and integration files pass across the resumed
isolated runs. Additional chart captures and post-diagnostic confirmation pass; post-cleanup affected
files, coordinated build/freeze, and migrations/runtime proofs remain. Rerun repository validation
after any resumed changes.

The tracked-symlink freeze guard remains at 36/36 synthetic/syntax/import cases and nine
query-document checks, with zero database connections. Its self-lock SHA-256 remains
`65a0cd2c707df78cc1b6b868d1a6430f455794bffe8ec9327fe3a1490bbdfae1`. The freeze-manifest builder is
ready at `/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-runtime/recreated-20261030-01/freeze-manifests.py`;
compile/help and read-only actual-inventory preflight passed for 5,189 regular files and 2 tracked
links, with zero manifests written. No coordinated freeze/build, manifest, acceptance-target startup,
or expectation regeneration has occurred. Actual freeze/manifests await all acceptance fixes. The old 2,500-path
freeze remains unchanged historical evidence only. Cleanup has removed temporary fixture diagnostics;
post-cleanup affected-file confirmation, coordinated build/freeze, and both migrations/runtime proofs
remain open. Repository-wide validation passes for this stopped checkpoint, not overall acceptance.

#### Prior checkpoint — 2026-10-29

Work resumed at the user's request. Overall status is **IN PROGRESS**; no overall acceptance or final
root validation is claimed. No commit or push was made, and no second review round is planned.

- Fitness browser acceptance is final at 3/3 (smoke 1/1, interactions 2/2). Exact numeric/history,
  edit-to-3.75, smoothing, raw-reading, zero-gap, and retry checks passed. All eight workout charts
  are clear. Compact measurement capture is clipped, so its visual gate remains open.
- The latest Media browser run is 1/2. Ranking, source-edit, and retry passed. The summary fix
  (viewport waits and chart-specific capture) is prepared but not rerun. Six projections are ready,
  with no pending or failed work. Earlier fixture-concurrency timeouts are historical; second-page
  and Home-link gates remain open.
- Remaining browser coverage is prepared in `e2e/src/browser/media-analytics-paging.test.ts` and
  `e2e/src/browser/analytics-home-links.test.ts`; the Fitness interaction capture now checks full
  plot visibility. Targeted format/lint passed. Package checks, real paging/link runs, and compact
  measurement visual acceptance are pending backend recovery completion.
- Discovery admits work before and between pages using set-based dependency joins. Its affected
  checks and unit tests passed. Relationship recovery now shares the events-owned required-target
  relation with discovery. The canonical Media reporting query path is unchanged; full discovery
  SQL validation and startup remain open.
- The user approved a kernel-wide relationship-recovery fence: two existing work-row revisions and
  current-claim fencing; account-wide fresh silent writes, root deduplication, and restore fencing;
  readiness across event roots and descendants; once-wave preparation with publication/catalog
  gates; and automatic startup, post-restore, and post-settlement recovery. Implementation and
  behavioral tests are ready, including migration
  `20261029090310_relationship_projection_input_repair`. Targeted format/lint passed; affected
  checks now pass 34/34 for backend, server, and E2E with their dependencies. The initial unresolved
  boot Layer requirements were fixed using the real feature ports. Backend tests passed 3,014/3,015
  across 351 files; one existing relationship-visibility case failed under the new account gate and
  is being diagnosed. The initial shell-limited interruption is not counted as a test result.
  Read-only discovery comparison passed all 150,028 eligible sources in 151 keyset batches, with zero
  six-column differences and equal 119,260-key batched unions. Full target, production discovery,
  and ordered-missing queries hit the unchanged five-second statement limit; unbatched global,
  ordered, and first-page equality were initially blocked. A private factored-selector candidate now
  passes all six-column, global, ordered-missing, and production first-page comparisons in one
  read-only snapshot. It is approved for exact application, followed by affected checks and backend
  tests. The visibility failure was a stale fixture account token; its correction retains ready,
  pending, retired-token, and disabled-account assertions. No new-code migration, startup, or
  acceptance pass is claimed.
- The earlier 2,500-path freeze `a6b15dd4f239ac832ed44833e3c2926e569dc6ee222b1b4560d67e01dfc1a36d`
  is invalid for current source after the discovery edit. Its artifacts and evidence remain
  historical. A new coordinated freeze and build are required before startup evidence.
- The normal `file` process is stopped. Exact comparison for 121,239 records, schema validation,
  all 43 asset proofs, restart, stability, and silence proofs are retained. Normal readiness, live
  metrics, and post-runtime proof have not passed. The `file2` migration has not run; its clone is
  unused.
- File2 source-derived expectations are prepared read-only for all 69 enabled accounts; 230 disabled
  accounts are excluded from live execution. Enabled history covers 350 workouts and 5,870 sets.
  Evidence is under `order16-file2-live-metrics-results-20261029-01` in the approved temporary
  directory. No destination or live query ran. Recorded source hashes remain evidence, but execution
  identities must be rebound to the new source freeze after recovery implementation.
- The user decided that `file2`'s 107 missing original assets are unavailable and waived as an
  overall acceptance blocker. Asset byte/owner verification remains not performed and unavailable;
  never mark it passed or reconstruct assets. Accept `file2` only if all remaining data, schema,
  group, silence, restart, runtime, live-metric, and stability gates pass. No `file2` or overall
  acceptance is claimed now.
- Substantial backend and acceptance work remains. Run affected checks before tests and serialize
  E2E runs with full-stream unique logs. Cleanup, a new coordinated build, and final root
  `bun run check` followed by `bun turbo --filter='!@ryot-app/e2e' test` remain.

#### Prior checkpoint evidence (historical) — 2026-10-29

Overall status is **IN PROGRESS**. This checkpoint supersedes older current-state wording below;
earlier failures and measurements remain historical evidence. No full acceptance or final root
validation is claimed.

- All nine P2 findings from the review are implemented. The review round is done; no second round is
  planned. Backend previously passed 3,000 tests across 351 files; Fitness passes (676 across 102 files); kernel
  renderers pass (90 across 6 files); contract, kernel-client, and UI package tests pass. The latest
  combined affected check passed 30/30. After semantic URL assertions replaced raw reporting-JSON
  equality and temporary Fitness diagnostics were removed, the E2E package check passed 34/34;
  kernel-client/server checks passed 31/31 through normal caches. Media's main check passed 26/26.
  Its latest completed domain run passed 1,889 of
  1,890 tests across 254 files; the recurring failure was a charts refresh-error case. The normal
  Turbo confirmation stopped before Media tests: its backend dependency passed 2,999/3,000, with
  `required-hooks-workflow.test.ts` measuring 1,230 ms against an unchanged 1,000 ms assertion.
  Rerun after the concurrent acceptance workload settles; no current full Media pass is claimed.
- The Media chart diagnostic is resolved: failed bridge replies were not drained before an expensive
  400-day DOM-role scan. A trace showed three current requests and no cancellations or follow-ups.
  The SDK zero-time clock and React/bridge drain resolved the issue. The focused suite passed 4/4 on
  four consecutive runs. This is not screenshot or domain-browser acceptance.
- Focused Fitness workout-records E2E passed 6/6. Its smoke fixture's unbound self-owner-revision
  query is fixed. The later URL timeout was a test defect: OAuth returned to the exact Analytics
  path and section with a complete isolated iframe, but reporting JSON keys had a different order.
  The three domain browser files now compare Schema-decoded selections using `stableStringify`,
  rejecting missing or invalid reporting values and retaining exact scope and Back checks. Fitness
  smoke/interactions ran with these fixes. Fitness smoke now passes 1/1, including exact week/day
  row counts, volume, ranges, section, Back, and summary values. All eight chart-specific light/dark
  compact/desktop images are readable and unclipped. The summary shows 2 workouts, 3 sets, 5,400
  seconds and 350 kg × reps. Interactions remain 1/2: offline retry passed; the drill case tried to
  change an inert background control while its modal was open. The test now uses the real close
  button and retains a modal-open Browser Back branch; rerun is pending. No product navigation or
  local-control retention feature was added. The last E2E check passed 34/34.
- The coherent full-stream Media browser rerun passed 0/2: fixture settling/readiness used the
  unchanged 180-second budget before any Analytics route response. No screenshots were generated;
  visual acceptance is unverified. Three independent typed entity creates now overlap without
  changing fixture data. Exact setup-stage diagnosis and missing second-page browser coverage remain
  open. Subsequent E2E runs are serialized to remove concurrent workload as a timing variable.
- Media retention runtime passed 3/3, including automatic repair on a fresh request identity,
  restored revision 0, exact source preservation, and all-time January 2 totals; no manual recovery
  was used. The latest coherent Media API rerun passed 1/4 (trends); totals stayed in fixture history
  work, source paging waited for canonical report readiness, and entity ranking waited on a public
  50-event operation after all 101 seeds. The 101 paging sources now use one public batch; cursor,
  ordering, filtering, and strict readiness assertions are unchanged. Earlier totals/date grouping
  passed 2/4, but neither cursor case has passed. The common fixture owner is preparing exact blocking
  stream/job evidence for a serialized run; concurrent timings are not a proven product regression.
  Timeouts and query limits are unchanged. The user-settings API command exited successfully.
- Serialized generic browser acceptance now passes 5/5: Analytics 3/3, reporting preferences 1/1,
  and reporting charts 1/1. This covers contributor Retry/controls/Back/catalog reload, compact drawer,
  exact deep-link reporting-control Back/reload with `keep=1`, timezone initialization/travel/validation,
  and real iframe keyboard/touch chart selection, exact values, retry, empty/zero/missing states.
  All 16 light/dark, compact/desktop, and motion-mode chart screenshots were retained and inspected;
  labels fit, comparison styling remains distinct, and missing values are not drawn as zero. Evidence
  logs are `analytics-exclusive-20261029-d73e.log`, `reporting-preferences-exclusive-20261029-d73e.log`,
  and `reporting-charts-exclusive-20261029-d73e.log` in the approved temporary directory. Product
  navigation is unchanged. Generic
  contribution API acceptance now passes 4/4 after preserving private capability warming/public
  denial and removing/reinstalling a valid dependency to test unavailable-section recovery. Its E2E
  check passed 34/34. Backup round-trip acceptance is 5/8: the evidence-provider entry-path/slug
  compile mismatch is fixed and its package check passed, but runtime rerun and an exact archived-event
  count mismatch remain open.
  Concurrent Turbo `errors-only` commands replayed mixed shared task
  logs; server-log attribution from those captures is unreliable. Subsequent E2E runs use full streamed
  output in separate private logs, without changing caches or capacity.
- Media's approved single-query diagnostics remain 946.445084 ms normal and 2,591.592 ms all-time.
  These are single diagnostics, not p95 results. No Media optimization, new chart dependency,
  rollup, framework, or version change is approved; limits are unchanged.
- Latest artifacts: Media ZIP 4,658,219 bytes, manifest 4,112,785 bytes (81,519 bytes below the
  unchanged limit), and emitted client files 375,164 bytes plus 471 bytes metadata; Fitness ZIP
  966,178 bytes, manifest 115,637 bytes, and emitted client files 545,680 bytes plus 838 bytes
  metadata. Clean build passed 8/8 in 1m55.16s; assembly passed in 36.565s. The 2,500-path source
  freeze matched after assembly (`a6b15dd4f239ac832ed44833e3c2926e569dc6ee222b1b4560d67e01dfc1a36d`).
  Private build evidence is under `order16-runtime/authorized-20261029-01` in the approved temporary
  directory. These are artifact measures, not migration acceptance results.
- Remaining open work includes focused runtime/browser acceptance, hosting, preferences, backup,
  writers, both real migrations with normal startup and restart, cleanup, and final root check/tests.
  Both migration targets passed fresh read-only preflight as unused legacy clones. The first `file`
  migration-only process exited 0 in 1,061.027 seconds, but exact comparison failed: no missing rows
  or extra canonical events, manual minutes matched 1,847, and Fitness matched all 52,926 rows;
  hashes differed for 66,146/66,188 Media facts, 2,090/2,090 evidence rows, and 35/35 parents.
  Field-level diagnosis attributes every difference to the private oracle retaining source
  microseconds instead of modeling PostgreSQL `timestamp(3)` storage before replay. Exact read-only
  casts explain every difference; structural/amount/identity/reference/order-key differences and
  logical-order inversions are zero. The narrowly corrected oracle now passes exact comparison for
  all 121,239 canonical records, with 30/30 PostgreSQL rounding-boundary cases verified. Raw JSON
  timestamp properties are unchanged. Fresh results are under `order16-oracle-corrected-20261029-01`;
  the original failed comparison remains retained. Persisted-schema validation passed all 121,239
  records with zero failures; migration silence/group gates passed all three checks; all 43 original
  assets passed full byte/owner proof. Completed migration-only restart exited 0 in 2.799 seconds,
  and all 11 snapshot inventory hashes stayed unchanged. A private tuple-serialization defect caused
  the original stability CLI to fail; its narrow repair now passes every original check: 178,492
  events, 148 reports, 124 details, and 115 schemas unchanged, with all 357,758 payload hashes
  recomputed. Failed evidence and captures remain preserved. Final restart gates passed with zero
  event-group, foreign-key, automation, or notification failures. File1 normal startup is healthy, but
  its first readiness gate failed: all 40,916 Fitness and 66,223 Media projected-source events, plus
  all 28,363 Media library relationships, are unready; queued/running/failed work counts are all zero.
  Diagnosis found discovery blocking binding before job admission, with the same query still active
  after 1,213.538 seconds and only 267 seeded streams. Relationship bulk admission is cron-owned and
  suppressed by the isolation flag; ordinary reads are read-only and do not enqueue it. The owned
  normal process was stopped with zero jobs admitted. A fresh `normal-stalled` diagnostic snapshot
  proves every event, report, detail, and schema unchanged from completed restart; this is source
  preservation, not successful runtime acceptance. Bounded discovery and repair-ordered canonical
  relationship recovery designs are in progress, without edits yet. This is startup/recovery work,
  not renewed Media reporting-query optimization. No manual repair, copied-integration dispatch, or
  notification work has been enabled. Source-derived expectations are prepared for 1,242 workouts,
  40,916 sets, and seven Media schema groups, with the source supplement read-only. No live metric
  comparison or normal-runtime stability pass is claimed yet. Heavy reconciliation is not running;
  Fitness acceptance has the next exclusive E2E turn while startup design remains read-only.
  The migrated target and captures
  remain intact; file2 is untouched. No migration acceptance is claimed. Its 107 unavailable original assets
  block full-asset acceptance only;
  data-only work continues. Preserve all source and benchmark resources. No commits or pushes.

- Earlier kernel event-group work integrated metadata, persistence, migration
  `20261028192959_event_groups`, writer/import integration, cascade, merge, and historical restore.
  An earlier combined run had
  202 passes and 21 failures; after fixture repairs, 24 lifecycle tests and 60 entity-service tests
  passed separately, as did the other 139 tests. A later backend consolidation passed after focused
  runs resolved earlier failures (19 reminders, 13 graph/definition, 18 namespace, and 32 workflow
  tests). The generic event-group HTTP suite passed all 3 cases. These results do not replace runtime
  publication acceptance. An earlier Media suite run had 21 failures and 1,784 passes across 245
  files, with failures in 15 files; the later domain-only package test run below cleared those
  failures. These runs are historical, not current package-test status.
- At an earlier checkpoint, after the typed-JSON fast path and generic lifecycle
  projection-admission integration, all seven affected-package checks passed (34/34). The next
  affected non-e2e Turbo consolidation passed
  49/49 test tasks: backend 2,976 tests across 348 files; Media 1,805 tests across 245 files; Fitness
  583 tests across 91 files; backend SDK 105 tests across 13 files; backend compiler 109 tests across
  8 files. Turbo reused 43/49 tasks through normal caching; runs were not forced. These are earlier
  results and do not describe the current package test state or final root validation.
- The generic immediate-projection admission fix is implemented. Post-write planning captures durable
  job IDs for affected streams, including no-hook writes; receipts carry `backgroundJobIds`, and the
  existing workflow dispatches those jobs after commit and before hooks. The arrange/reconcile owner
  also handles recovery. The backend passed 383 focused tests across 18 files and the full affected
  backend suite above. No worker, limit, format, or version changes were made. Unavailable bindings
  remain pending; real admission failures roll back atomically.
- Generic restore-to-plugin input repair is now implemented and integrated. It uses existing stream
  state and background work, a restore epoch, an optional plugin companion, a strict first-companion
  readiness gate, and bounded post-restore/startup recovery. It preserves before-policies, validation,
  receipts, source fencing, and strict readiness; root work `SUCCESS` does not mean a plugin stream is
  ready, and ordinary after-hooks are never replayed. The trusted `afterHooks: "skip"` foundation
  passed 25 focused tests, the Media script passed 6 focused tests, and core integration passed 112
  tests across 7 files. Root Turbo checks across 3 filters passed 23 tasks. Full backend/domain
  runtime and restore acceptance remain pending.
- Earlier draft-type corrections passed strict compiler analysis and 42 logger tests; activity-runs
  has 20 passing tests. Artifact terminology correction: the earlier 4,108,339-byte measurement is
  the uncompressed Media `manifest.json`, 85,965 bytes below the unchanged 4 MiB manifest limit; it
  is not the ZIP archive or compiled client artifact. The measured existing prior ZIP is 4,601,368
  bytes and its compiled client module is 264,389 bytes. No newer stable Media UI archive is
  available. The compiled-client 8 MiB, source 1 MiB, and manifest 4 MiB limits are unchanged; UI
  JavaScript does not directly consume manifest-byte headroom, and no new-build fit is claimed.
- The kernel typed-JSON fast path and its `json-casts` integration coverage are implemented. Six new
  and 93 existing focused tests passed; types, lint, and format checks passed. An earlier 138-case
  adversarial PostgreSQL differential proof passed and is separate from the native 99-test count.
  The path is bounded to physical JSON and strict nonnumeric object keys; fallback remains for
  integer-like keys, invalid Unicode, derived/translated values, subqueries, JSON elements, and
  non-JSON casts. The seven-package checks above include this path, but do not validate the full root.
- On 2026-10-29, the owner accepted Media's current query speed as adequate for the current
  implementation and waived the former warm-p95 targets as release blockers. The latest durable
  seven-query normal-period diagnostic took 946.445084 ms for the full first recipe, including durable
  writes. Its decoded output matched the earlier source-date capture exactly; that baseline matched
  its independent oracle across 29,418 scalar values. A separate all-time single-execution diagnostic
  completed seven queries in 2,591.592 ms; decoded totals matched source expectations. Neither result
  is a p95, and no complete 20-warm-sample acceptance run was captured. The scoped
  projection-stream prefilter was rejected:
  its single raw samples regressed all-time current (637.092 to 668.732 ms) and month current
  (147.018 to 180.678 ms), while coverage changed from 234.939 to 230.186 ms. Exact raw equality
  does not make this a performance pass. The four-query candidate was also rejected (3,822 ms versus
  1,169 ms, including 2,269 ms JIT) and changed fractional reassociation. A separate read-only
  shared-scan feasibility prototype totaled 614.699 ms in one uncontrolled execution; it is not a
  p95 or a controlled speedup from the 1,704.675 ms loaded baseline. Stop further Media query
  optimization for the current implementation: the canonical seven-query path is unchanged, and the
  shared-scan, projection-prefilter, and four-query candidates remain unimplemented and not
  production-approved. No floating-point change, new SQL shape, framework, dependency, or reduction
  in correctness/readiness is approved. Evidence and limits are recorded in the Media README.
- Media recipes, models, and adapters now use stable calendar inputs without execution-time values in
  cache keys; 39 owned tests passed, and the canonical seven-query report AST and arithmetic remain
  unchanged. Media summary, charts, ranking/records, section, and manifest UI work is actively being
  implemented, not complete. Media Home implementation is complete in `activity-section.tsx`,
  `screen.tsx`, and their tests: it uses account reporting timezone, stable `{ timeZone }` query input,
  execution-clock windows, actual account-midnight/DST scheduling, retained refresh failures, and the
  Analytics link; `activity-model.ts` is unchanged. Formatting, lint, and whitespace passed, while
  full Media tests, typecheck, and package check remain unrun. No runtime UI acceptance is claimed.
- An earlier Media functional run failed 4/4 (three 180-second timeouts and one overbroad helper
  assertion); the current runtime passes 4/4. The corrected assertion checks that deleting the only
  consumable parent completion leaves no parent group, as required by suppression. Source writes,
  current revision/freshness,
  parent-child 50-minute totals, title counts, suppression, and edit repair passed. This ordinary
  writer proof does not establish 100,000-row publication, retention, merge, or restore acceptance.
- Fitness's local SQL-plus-decode warm gate now passes all 20 rolling/all-time recipe cases. Each
  case has 20 warm samples; the worst p95s are 362.813459 ms rolling and 1,218.724083 ms all-time,
  under the unchanged 500 ms / 2,000 ms limits. All 20 decoded results match their baselines
  exactly, and current source hashes match all 199 captured paths. This synthetic local gate does
  not claim HTTP, iframe, ordinary-writer, or scale-publication acceptance. Fitness summary, charts,
  ranking/drilldown, measurement views, section/manifest registration, and the Home Analytics link
  are implemented. Reporting adapters passed 26 focused tests; their child suites passed 6, 10, and
  8 tests, with 4 section tests and 6 Home tests also passing (these split counts are not a package
  total). The main Fitness package check passed 26/26. Its latest package test command,
  `bun turbo --filter=@ryot-app/fitness-plugin test --only`, passed as one task in 20.621 seconds:
  636/636 tests across 98 files. The earlier 635-pass,
  1-failure result was an outdated exact manifest expectation and is historical; the expectation is
  fixed and focused 3/3 tests pass. The archive build and client compiler passed. The measured Fitness
  ZIP is 965,166 bytes, its manifest is 115,637 bytes, and its compiled client module is 403,350
  bytes; wider-coverage status is unverified, and these are artifact measurements, not full acceptance.
  Six affected shared client packages passed checks (11 tasks) and tests (6 tasks);
  `@ryot-app/server` passed its `check --only` as one task.
  The earlier E2E package check passed before the new interaction test was added; the current E2E
  package check has one type error in `fitness-analytics-interactions.test.ts` (native/wrapper
  locator), and the owner fix is active. No current-checkpoint E2E runtime has run. See the Fitness
  README for per-case timings and capture evidence.
- The Fitness reporting-charts iframe suite now passes 1/1 after test-only assertion fixes. It
  covered all eight visual modes and 16 screenshots, keyboard/touch selection, exact-value table,
  retry, empty/zero/missing states, light/dark, compact desktop and reduced motion. The missing
  current mark remains a nonselectable tooltip context; Enter selects the aligned known comparison
  (`3 entries`, 2026-08-03). Earlier invalid-URL, stale-label and missing-current attempts are
  historical, not current failures. Scoped checks passed. Evidence is in
  `/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/chart-selection-runtime-20261029/`
  (`result.md`, `complete-vitest.log`).
- An earlier Media retention runtime was **2/3, not acceptance**: merge passed, clear/reuse passed,
  and restore setup wait timed out at 180,003 ms. There is no accepted restore result; source facts
  observed before the stale assertions do not prove restored data. Generic automatic restore repair
  admission is now implemented, but full retention acceptance remains open. The minimal-fixture
  correction is active; no restore pass or manual retry is claimed. No diagnosis is claimed. Evidence
  logs:
  `/Users/diptesh/.local/share/opencode/shell/69c95d6aa34813057528c971b0d0be7ab227f764/sh_1856a5aae0019qzjhlx6ENsrv3.out`;
  server and PostgreSQL logs are `/tmp/ryot-e2e-server-logs-MXbcut/ryot.log` and
  `/tmp/ryot-e2e-postgres-98717.log`.
- The complete global status remains **IN PROGRESS**. Media domain UI implementation remains active;
  Fitness UI surfaces are implemented but its package/browser acceptance remains open. Full
  backend/domain restore runtime, broader browser/lifecycle acceptance, retention/merge/restore
  acceptance, publication, and both real-dump migrations plus normal startup/restart remain open. Both
  disposable targets passed read-only preflight against unused legacy clones; no migration, normal
  startup, or restart was run. All 43 original assets were byte-hash retained in `file1`; `file2` is
  missing 107 originals, blocking full asset acceptance while data-only work continues. Original
  source and benchmark resources are preserved. Broader combined-test attempts were blocked by
  in-progress Media archive UI types and the missing file, not by core test failures, and are not
  final validation. Review, cleanup, and final root validation remain open. The former
  Media warm-p95 targets are waived as release blockers, although no complete 20-warm-sample p95 was
  captured. Earlier affected checks (34/34) and test tasks (49/49) remain historical results; final
  `bun run check` and root non-e2e tests have not run. No commits were made.

### Earlier checkpoint evidence

- Shared toolbar and permanent kernel collection reviews were integrated. Thirteen focused
  renderer/widget tests passed; five controls tests passed at a separate earlier checkpoint, so those
  counts are not additive. Backup work had 135 tests pass across nine changed files; its e2e coverage
  was authored but not run.
- Earlier Fitness work had 155 focused tests pass across 18 changed files. Earlier Media work had 62
  contract/allocation tests pass. These counts precede the latest split-run checkpoint above.
- Migration work had nine rollback-only SQL cases pass and generated event-manifest/allocator
  validation pass (512). This was source-baseline validation only: no real migration, build, or
  assembly ran. Disposable targets were created; source databases remained intact.
- Earlier generic direct multi-input projection work had 56 tests pass. Through reverse-reference
  runtime, phantom-lock, and restore tests were then incomplete.

At that earlier checkpoint, full UI/runtime and consolidated acceptance, broader browser acceptance,
restore/retention, real-dump migrations and restart, cleanup, and final repository validation were
pending. The owner-accepted Media speed was not a p95 result.

## Appendix — implementation evidence moved from source READMEs

The following records were moved out of package documentation. They are historical run evidence,
not current architecture; temporary paths refer to the original sessions and may no longer exist.

### A. Migration inventory and acceptance handoff

Moved from `apps/server/src/migrations/order-16-acceptance.md`.

Inventory taken on 2026-10-28; mapping milestone updated on 2026-10-29. Media source facts, numbered
Anime/Manga items, parent correction evidence, and Fitness occurrence snapshots are implemented.
Production processor/readiness and writer audits remain in progress with their owners. No real-dump
migration, archive build, or server assembly has run. The analytics plan and migration runbook were read.

##### Current execution checkpoint — 2026-10-30 (replacement run)

Both replacement targets were migrated from current sources, with results in the
[analytics plan](#current-status--2026-10-30-replacement-environment-run).
`file` and `file2` pass migration-only exact comparison, persisted-schema validation, silence, event-group
and foreign-key gates, and completed-restart stability. File passes all 43 asset proofs. File2 reports
exactly its 107 waived unavailable originals. Normal startup no longer stalls in discovery or readiness,
but one-time Media correction catch-up for a large account takes hours, so the owner moved runtime
readiness to a VM.

On the VM, deploy this commit with clean PostgreSQL, Redis and storage. Restore each dump into its own
database, run migration-only mode, then start normally and leave it running. After reconciliation,
run the runtime gates while the process is alive. Then stop it and run runtime stability against the
completed-restart snapshot. Local evidence is under `order16-runtime/claude-20261030-01/`. The local
targets keep their migrated data with containers stopped.

##### Prior execution checkpoint — 2026-10-30 (morning)

Post-cleanup acceptance is blocked at Media API 3/4: entity ranking exceeds the unchanged 180-second
budget. Later post-cleanup browser files, coordinated build/freeze, fresh expectations, and both
replacement migrations/runtime proofs remain unstarted. The owner declined broader runtime diagnosis
and requested documentation plus an `o16` checkpoint commit. Investigation, retries, builds, and target
execution are stopped. Repository-wide checkpoint validation passes: `bun run check` (52 boundary-rule
tests; 38/38 tasks, 33 cached), then `bun turbo --filter='!@ryot-app/e2e' test` (51/51 tasks, 48 cached).
Logs are under `order16-checkpoint-validation-rl4l1ez2/` in the approved temporary directory. These
passes do not supersede the E2E blocker or prove migration/runtime acceptance. No push or overall
acceptance is requested or claimed.

Current affected checks pass 34/34, and backend validation passes 3,023 tests across 352 files
(40/40 tasks, 35 cached), including early preparation and queued coalescing. The proven discovery
helper and corrected account-generation fixture are present in
the current checkout, including newer unrelated commits that this session preserves.
Latest Media validation passes 1,914 tests across 256 files (46/46 tasks, 42 cached); Fitness remains
675 tests across 102 files from the prior 47/47-task domain run. These are package results, not
replacement-target migration or runtime acceptance.

An earlier normal Media API run passed **4/4**, including both real 100+2 cursor cases. Entity ranking
passes in 176.104 seconds with original 50-item batches and the unchanged 180-second budget. The queue
then stopped at browser paging: its exact first-page date labels differed only between Bun and Chromium
Intl punctuation. The expectation now formats public source instants in Chromium; exact timestamps,
facts, quantities, row contents, and pagination assertions remain. Corrected browser paging now passes
1/1 (88.547 seconds), including the real Show more action and exact 102 rows. Home links now pass 2/2
after scoped timezone assertions and stable-container scrolling for Media's lazy section. Fitness's
interaction file now passes 2/2 after constraining its tab panel and selected metric label. The captured
482-pixel overflow in a 390-pixel viewport is fixed; the fresh 326×200 plot is readable and unclipped.
Strict full-plot visibility and both horizontal-overflow checks pass. Fitness tests pass 675/675 across
102 files (46/46 tasks, 42 cached). Backup round-trip acceptance passes 8/8. The writer file stopped
at 12/13 on an obsolete empty-properties expectation. Its test now requires the exact canonical bases
on on-hold/dropped events while retaining the no-extra-progress assertion; no writer behavior changed.
The rerun passes writers 13/13, imports 2/2, and integrations 5/5. All eight focused files have passing
evidence across serialized isolated runs (37 tests), not one coordinated-freeze run; the later API timeout
is the current blocker. Evidence is under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-e2e-sequence-20261030-hgabnbmm/`.
Additional Media and post-diagnostic Fitness runs pass 2/2 each; all 5,191 tracked paths are unchanged
before/after both. Trend/hour and latest Fitness plots are readable and unclipped. Calendar captures
now include the enclosing Daily consistency card, not only its tiny cell grid. That affected Media
file passes 2/2 with unchanged sources, and all four contextual calendar images are readable.
Evidence is under `order16-final-browser-captures-682muwom/` and
`order16-final-browser-captures-wojg8bby/` in the approved temporary directory.
Corrected read-only pre-freeze infrastructure checks pass for the three services, both unused legacy
targets and source-count anchors, and free startup ports (`order16-pre-freeze-infra-bmlws2hq/`).
The prior probe failed only because its template assumed a storage health-check field; that evidence
remains preserved. No migration or runtime acceptance follows from these preconditions.
Main-session cleanup from checkpoint `1bcff025ba` removes 180 net lines of temporary Media fixture
diagnostics, retaining all writers, canonical readiness, assertions, teardown, and historical evidence.
Post-cleanup confirmation of the three affected Media files remains before coordinated build/freeze.
Its first API run stopped at 3/4 on the unchanged 180-second ranking budget (181.601 seconds including
teardown); all tracked paths stayed unchanged and the two browser files did not run. Evidence is under
`order16-final-browser-captures-55q01yja/` in the approved temporary directory. The ranking fixture
was tested with the exact resolved Book schema through the same seeding implementation, removing
101 redundant admin lookups. That confirmation also remains 3/4: ranking timed out (185.687 seconds
including teardown), all tracked paths stayed unchanged, and both browser files did not run. Evidence
is under `order16-final-browser-captures-xuvvj_tj/`. The unsuccessful fixture change is removed; all
original data, seeding, writers, concurrency, batching, readiness, cursor assertions, and budgets remain.
Passing/failing span aggregates are retained under `order16-cleanup-ranking-spans-wue2s4ry/`, with zero
PostgreSQL errors/deadlocks; concurrent span totals do not establish causal-stage timing. The owner
declined broader runtime-cost diagnosis. Restored-fixture checks pass 34/34 (31 cached), with evidence
under `order16-restored-fixture-check-u2bziq2m/`. Build, freeze, fresh expectations, and replacement-target
execution remain unstarted.

New approval is required to resume the ranking fix and affected-file confirmation, coordinated
source/artifact build and freeze, fresh guarded expectations, and both replacement-target acceptance
sequences. Complete migration exact/schema/assets/silence/group/restart gates, normal automatic
recovery/readiness, strict live comparisons, and stopped-runtime stability one dump at a time. Preserve
all evidence and keep tracked documentation unchanged during guarded runs. File2's 107 unavailable
original assets remain unverified; its conditional overall waiver applies only after all other gates
pass. Interrupted-migration experiments remain separately unapproved.
Completed API and initial browser logs are under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-e2e-sequence-20261030-02zgonru/`.
Passing browser paging and failed Home-link logs are under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-e2e-sequence-20261030-xnitqw0q/`.
Passing Home-link and failed Fitness visibility logs are under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-e2e-sequence-20261030-weu29ym0/`.
Passing Fitness and compact-image evidence is under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-e2e-sequence-20261030-skbi1w1n/`.
The same run retains the 8/8 backup pass and prior 12/13 writer result; the later writer/import/integration
passes supersede that expectation failure. Additional Media captures and Fitness's post-diagnostic
confirmation pass. No replacement-target acceptance is claimed.

The prior observed post-coalescing API run passed 3/4: totals/trends and the 102-Anime source
cursor pass (112.503 seconds); entity ranking still times out before its cursor assertions, with
50 Book pending. It retained 34 read-only snapshots with no observer errors. HEAD and all six
observed source hashes stayed unchanged. Evidence is under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-observed-media-api-cni7iope/`.

The prior pre-coalescing isolated API run passed 3/4: totals/trends and the 102-Anime source-cursor case
passed (119.015 seconds; 100+2 real cursor pages, with exact order, filters, contributions, and
independent occurrences unchanged). The 101-entity ranking case timed out in 189.134 seconds with
50 Book pending before its cursor assertion. The current 100-row truncated sample has `hasMore: true`,
with 50 running and 18 queued user-work rows, 17 running and 15 queued projection rows, 50 scopes,
and zero errors. The remaining seven queue files did not run; the other E2E runner remains user-paused.
Prior pre-coalescing evidence is under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-stale-projection-api-diagnosis-20261030-ydki1k0n/`.

The earlier coherent 2/4 API result is historical, not current: totals/trends passed; both cursor
cases timed out before their respective assertions; the other seven files did not run. Its full
truncated-snapshot evidence remains under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-e2e-sequence-20261030-48q9tz1e/`;
the analytics plan retains its sample details. Latest retained logs show 428 projection-process/331
publish spans, versus the prior 1,025/118; these counts are spans, not unique jobs. Temporary
physical-row blocking clears, with no PostgreSQL errors or deadlocks; at that checkpoint, logical
shared-library identity remained unproven (prior evidence; see the latest diagnosis below). Atomic
queued coalescing is implemented through the existing background-work owner; checks pass 34/34 and
backend tests pass 3,023/3,023 after a regression fixture adopted the
same projection authority. The observed post-coalescing API run remains 3/4, so full acceptance is
not claimed. At that point, the retained job, repair-phase, and lock-identity snapshots awaited diagnosis;
see the latest diagnosis below.

Latest diagnosis from `/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-observed-media-api-cni7iope/`:
snapshots 22–33 before the 03:50:57.299 UTC failure show each of the first 50 Book corrections
retaining one running silent worker, one stable request key, two run keys, `force=false`, and
`conflictAttempt=0`; each restarted exactly once from `sourceRevision=1` to `2`, and none finished
the second pass before failure. Ordinary workers were queued with distinct request/work keys, not
concurrent writers of the same state. Uncapped snapshot 33 has 271 active jobs: 50 running silent,
20 queued ordinary, 47 running projections, and 154 queued projections. Every queued projection is
current; six running claims are stale, so the earlier obsolete-queued-backlog explanation does not
apply. Root tuples prove a shared logical lock on one Media Library entity. Its 565 conditional
logged acquisitions averaged 915 ms, with a 2.734 s maximum; these are not p95 or population
latency, and no deadlock was observed. Only 50 of 101 new Book source events were written; 51
remained absent in that run. Warning correlation alone did not identify the revision-2 source write.
The prior test identity remains valid: HEAD `f497` and six source hashes were unchanged, and the test
finished before commit `1bcff025ba`.

The completed source-write diagnostic remains 3/4: totals/trends and the 102-Anime source cursor pass
(91.868 seconds); entity ranking times out before cursor assertions. Its 32 read-only snapshots have
no observer errors; HEAD `1bcff025ba` and ten observed source hashes stayed unchanged. Evidence is under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-observed-media-sources-1v_ca21j/`.
Snapshot 19 has only an unchanged `complete` event on each first-wave Book at scope revision 1;
snapshot 20 adds `add-to-media-library` at revision 2, with neither event edited. The membership hook
writes on each Book and legitimately advances the history guard through `EventsRepository.touchScopes`.
The aggregate proof passes 22/22 evidence assertions under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-membership-revision-proof-tax_cy3a/`.
All first 50 corrections reach `done` at revision 2 by snapshot 29; another 50 source writes then
arrive. This failure has 78 Book sources pending, not the prior run's fixed first-wave backlog.
No further generic scheduler change is justified. Ten-Book fixture backpressure passed checks 34/34
(28 cached), but its API run remained 3/4: 40 Books settled before the unchanged 180-second budget,
with 10 more pending. Its 31 error-free read-only snapshots and unchanged HEAD/ten source hashes
are retained under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-observed-media-sources-8v_w7byy/`.
The unsuccessful fixture change is removed; original 50-item batches and all 101 additions remain.
A Media-owned fast path now settles fresh flat corrections with no progress, occurrence/coverage
evidence, or missing dependencies in one guarded `done` checkpoint. It retains source baselines,
per-record guards, publication gates, real writers, and canonical calculations; progress/evidence
and episodic corrections keep the paged state machine. Affected checks pass 34/34 (29 cached); Media
tests pass 1,914/1,914 across 256 files (46/46 tasks, 42 cached), including seven new fast-path and
exclusion cases. The fast-path run with original 50-item batches remained 3/4, with 30 error-free
snapshots and unchanged HEAD/12 source hashes under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-observed-media-sources-8ufh8bgj/`.
All 101 new Book sources reached `done` at revision 2; the post-timeout capture shows canonical
`ready` with zero pending/failed sources, not on-time acceptance. A later first-page assertion also
exposed locale-based expected ID ordering against the query's byte order. The expectation now uses
direct ID comparison. The aggregate proof is retained under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-flat-ranking-proof-jzihu7nj/`.
Ten-item batches with the fast path still remained 3/4: 90 Books settled and 100 were written, with
11 Book sources pending and the last addition not written. Evidence is under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-observed-media-sources-wopgh266/`.
It retained 30 snapshots and unchanged HEAD/12 source hashes; the observer later failed because
teardown had stopped its pinned container. That error remains recorded. The normal 25-item run also
stopped at index 0 with API 3/4 and 16 Book sources pending; the seven remaining files did not run.
Its log is retained under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-e2e-sequence-20261030-l2oxocgn/`.
Backpressure is removed. The successful normal API run retains only the fast path and byte-order
expectation fix, with original 50-item batches, one final correction wait, and no diagnostic observer.
All data, real writers, readiness, totals, 100+2 cursor assertions, and the 180-second budget remain.
Checks pass 34/34 (31 cached). That queue passed API 4/4, then stopped at browser paging on the Intl
label difference described above. Corrected browser paging, Home links, and Fitness's new visual gate
and backup, writer, import, and integration files pass across the resumed isolated runs. Additional
chart captures and post-diagnostic confirmation pass; post-cleanup affected-file confirmation remains.

The tracked-symlink freeze guard remains at 36/36 synthetic/syntax/import cases and nine
query-document checks, with zero database connections. Its self-lock SHA-256 remains
`65a0cd2c707df78cc1b6b868d1a6430f455794bffe8ec9327fe3a1490bbdfae1`. The freeze-manifest builder is
ready at `/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-runtime/recreated-20261030-01/freeze-manifests.py`;
compile/help and read-only inventory preflight passed for 5,189 regular files and 2 tracked links,
with zero manifests written. No coordinated freeze/build, manifest, acceptance-target startup, or
expectation regeneration has occurred; these remain pending all acceptance fixes. The current guard tool is
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-live-current-freeze-20261030-m7mb7y7d`
and its recorded 2,500-path provenance remains unchanged historical evidence only.

The private frozen-runtime launcher is prepared beside `freeze-manifests.py`. Compilation, help, and
import-only path/environment checks pass, including separate file/file2 storage and logs. It targets
the verified built backend bundle, not source execution, and records local freeze checks around each
future process. No actual freeze verification, target startup, or migration has used it.

The former Order16 containers are no longer available in either configured Docker context. Original
dumps, immutable captures, proof logs, and the file1 asset cache remain. The user explicitly approved
fresh isolated containers and source/target databases from those originals, preserving prior evidence.
Fresh infrastructure is running and both legacy target clones match their restored source table
counts. Both buckets contain 58 cached objects totaling 284,336,460 bytes; all 43 file1 originals
match retained byte hashes, sizes, and content types. Read-only verification of both restored sources
matches every retained source fingerprint exactly. Neither replacement target has passed migration,
normal-readiness, or live-metric acceptance. Earlier file1 results below remain historical. File2's
missing 107 originals remain unavailable and waived as
an asset-verification acceptance blocker only; all remaining data and runtime gates still apply.
No interrupted-migration experiment is authorized. The user authorized an Order16 checkpoint commit
with the `[v1-v2-port-gap-o16]` prefix while acceptance remains open; no push is requested.

##### Prior execution checkpoint — 2026-10-29

Work resumed at the user's request. Overall status is **IN PROGRESS**; no overall acceptance or final
root validation is claimed. No commit or push was made, and no second review round is planned.

- Fitness browser acceptance is final at 3/3 (smoke 1/1, interactions 2/2). Exact numeric/history,
  edit-to-3.75, smoothing, raw-reading, zero-gap, and retry checks passed. All eight workout charts
  are clear; compact measurement capture is clipped, so its visual gate remains open. Media browser
  acceptance is 1/2: ranking, source-edit, and retry passed; the prepared summary fix (viewport waits
  and chart-specific capture) was not rerun. Six projections are ready with no pending/failed work.
  Earlier fixture-concurrency timeouts are historical; the second-page and Home-link gates remain open.
- Discovery admits work before and between pages using set-based dependency joins. Its affected
  checks and unit tests passed. Relationship recovery shares the events-owned required-target
  relation with discovery. The canonical Media reporting query path is unchanged; full SQL validation
  and startup remain open.
- The user approved kernel-wide relationship recovery covering two existing work-row revisions and
  current-claim fencing; account-wide fresh silent writes, root deduplication, and restore fencing;
  readiness across event roots and descendants; once-wave preparation with publication/catalog gates;
  and automatic startup, post-restore, and post-settlement recovery. Implementation and behavioral
  tests are ready, including migration `20261029090310_relationship_projection_input_repair`.
  Targeted format/lint and affected backend/server/E2E checks passed (34/34 tasks), after fixing
  boot Layer provision. Backend tests passed 3,014/3,015; one existing relationship-visibility case
  needs diagnosis under the new account gate. Read-only discovery comparison passed all 150,028
  eligible sources with zero six-column differences, but full production discovery hit the fixed
  five-second statement limit. A private factored-selector candidate subsequently passed complete
  six-column, global, ordered-missing, and production first-page equality in one read-only snapshot.
  Exact application and revalidation are next. The failed visibility case used a stale fixture token;
  its correction keeps the visibility guarantees. No migration or startup has used the new code,
  and no new acceptance pass is claimed.
- The prior 2,500-path freeze
  `a6b15dd4f239ac832ed44833e3c2926e569dc6ee222b1b4560d67e01dfc1a36d` is invalid after the discovery
  edit. Original artifacts and evidence remain historical. A new coordinated freeze/build is required
  before startup evidence.
- The normal `file` process is stopped. Exact comparison for 121,239 records, schema validation,
  all 43 asset proofs, restart, stability, and silence proofs are retained. Normal readiness, live
  metrics, and post-runtime proof have not passed. The `file2` migration has not run and its clone is
  unused.
- File2 source-derived expectations are prepared read-only for 69 enabled accounts, excluding 230
  disabled accounts from live execution. Enabled history covers 350 workouts and 5,870 sets. Private
  evidence is under `order16-file2-live-metrics-results-20261029-01`. No destination or live query ran;
  execution identities still need the new post-implementation source freeze.
- The user's new decision is that `file2`'s 107 missing original assets are unavailable and waived as
  an overall acceptance blocker. Asset byte/owner verification remains not performed and unavailable;
  never mark it passed or reconstruct assets. Accept `file2` only if all remaining data, schema,
  group, silence, restart, runtime, live-metric, and stability gates pass. No `file2` or overall
  acceptance is claimed now.
- Substantial backend and acceptance work remains. Run affected checks before tests and serialize
  E2E runs with full-stream unique logs. Cleanup, a new coordinated build, and final root
  `bun run check` followed by `bun turbo --filter='!@ryot-app/e2e' test` remain.

###### Prior execution evidence (historical)

This earlier checkpoint supersedes older deferred-execution wording. Fresh read-only preflight passed:
both existing targets were unused legacy clones, ports 32780/32781 were free, and retained source and
asset evidence was recorded complete at that time. The clean coordinated build passed 8/8 tasks in
1m55.16s; assembly passed in 36.565s. Its 2,500-path source fingerprint was then recorded as unchanged:
`a6b15dd4f239ac832ed44833e3c2926e569dc6ee222b1b4560d67e01dfc1a36d`.

Private execution evidence is retained under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-runtime/authorized-20261029-01`.
The first `file` migration-only process exited 0 in **1,061.027 seconds**. The stopped-app snapshot
captured 294,513 records across 11 kinds, including 178,492 events and 43 managed assets. Exact
comparison then exited 1: no missing rows or extra canonical events; manual minutes matched 1,847;
Fitness matched all 52,926 rows. Hashes differed for 66,146/66,188 Media facts, 2,090/2,090 correction
evidence rows, and 35/35 parent outputs. Read-only field diagnosis explains every discrepancy through
the schema's PostgreSQL `timestamp(3)` conversion: the private oracle retained source microseconds
before parent/evidence replay. Structural, amount, ownership, identity, reference, order-key, and
logical-sequence differences are zero. A schema-specific oracle correction and fresh comparison
outputs now **pass exact comparison for all 121,239 canonical records**, with 30/30 PostgreSQL
rounding-boundary cases verified. Raw JSON timestamps remain unchanged. Fresh private evidence is
under `order16-oracle-corrected-20261029-01`; no production change, rebuild, or migration rerun was
needed. The original failed comparison, target, and captures remain preserved. Persisted-schema
validation passed all 121,239 records with zero failures; all three migration silence/group checks
passed; all 43 originals passed full managed-asset byte/owner proof. Completed migration-only restart
exited 0 in 2.799 seconds, and all 11 inventory hashes stayed unchanged. The original stability CLI
failed on tuple serialization. The narrowly repaired private validator now passes all original
checks: 178,492 events, 148 reports, 124 details, and 115 schemas unchanged; 357,758 complete payload
hashes were recomputed. Both snapshots and the original failed log remain unchanged. Final restart
gates passed with zero event-group, foreign-key, automation, or notification failures. The first normal
startup is healthy at the isolated loopback port, but its first runtime gate failed: 40,916 Fitness
events, 66,223 Media events, and 28,363 Media library relationships are all unready, with zero queued,
running, or failed jobs. Discovery blocked binding for over 20 minutes; relationship bulk admission
was suppressed with cron by the isolation setting, and ordinary reads do not admit it. The owned
stalled process was stopped with no jobs admitted. The fresh `normal-stalled` snapshot passes exact
event/report/detail/schema stability against completed restart; it is diagnostic preservation only,
not runtime acceptance. Bounded event discovery and repair-ordered
relationship startup/post-restore recovery are being designed; no production edits have started.
No manual recovery or copied external dispatch has been enabled. Source-derived
expectations are prepared using read-only Fitness supplements and the corrected oracle. Live metric
comparison and stopped-runtime source stability remain open; no complete migration acceptance is claimed.
File2 is untouched and remains
data-only because its 107 original assets are unavailable. No interrupted-phase experiment is
authorized. Source databases, dumps, captures, and benchmark databases remain preserved.

The initial assembly invocation with Bun's `--cwd` placement printed usage rather than assembling;
its log is retained. The successful invocation used `apps/server` as the shell working directory.
Runtime invocations use that working directory too; a usage-only exit is not migration acceptance.

#### Source inventory

Both original files are PostgreSQL custom archives, despite their `.sql` extension. They restored
successfully with PostgreSQL 18 `pg_restore --exit-on-error --no-owner --no-privileges` into separate,
new disposable databases. No source dump was changed.

| Evidence                                   | `tmp/file.sql` (34 MB) | `tmp/file2.sql` (239 MB) |
| ------------------------------------------ | ---------------------: | -----------------------: |
| Users                                      |                      1 |                      299 |
| Metadata                                   |                 38,648 |                   44,355 |
| Seen rows                                  |                 66,188 |                  654,769 |
| Completed seen rows with no finish date    |                  1,121 |                   29,130 |
| Seen rows with manual time                 |                      2 |                       50 |
| Manual time, seconds                       |                110,820 |               24,253,140 |
| In-progress manual-time rows               |                      0 |                       11 |
| In-progress manual time, seconds           |                      0 |               14,013,420 |
| Known finish timestamps at UTC midnight    |                 18,952 |                   86,218 |
| Workouts                                   |                  1,242 |                      648 |
| Workout exercise occurrences               |                 10,768 |                    4,003 |
| Workout sets                               |                 40,916 |                   11,095 |
| Sets without `confirmed_at`                |                 15,121 |                    5,601 |
| Sets with a `rest_time` key                |                 24,411 |                    5,027 |
| Exercise occurrences with legacy muscles   |                  9,389 |                    1,775 |
| Exercise occurrences with legacy equipment |                  9,519 |                    1,638 |
| Measurement rows                           |                    224 |                       62 |

Both sources have no empty seen update arrays, negative/zero manual-time values, or workout exercise
references missing from the legacy exercise table. These are source observations, not acceptance
results for migrated data.

##### Source baselines for later comparison

These aggregates were read only from `order16_file_source` and `order16_file2_source`, with PostgreSQL
`default_transaction_read_only=on`. Each seen row remains an independent source occurrence; update
arrays were not expanded or interpolated. Counts below are V1 states, not inferred V2 title
completions. `F+`/`F−` mean present/absent `finished_on`; `S+` means present `started_on`. Timestamp
presence does not establish exact-hour precision. Partial cumulative values still need undated
baseline classification; an old finish timestamp on a changed state is not a new observation date.

| Dump  | Media type   | State       |    Rows |      F+ |     F− |     S+ |
| ----- | ------------ | ----------- | ------: | ------: | -----: | -----: |
| file  | audio_book   | completed   |     115 |     113 |      2 |    107 |
| file  | audio_book   | dropped     |       1 |       0 |      1 |      1 |
| file  | audio_book   | in_progress |       1 |       0 |      1 |      1 |
| file  | book         | completed   |     297 |     195 |    102 |     32 |
| file  | book         | dropped     |      12 |       0 |     12 |     12 |
| file  | movie        | completed   |     652 |     397 |    255 |    351 |
| file  | movie        | dropped     |      15 |       0 |     15 |     15 |
| file  | movie        | in_progress |       1 |       0 |      1 |      1 |
| file  | music        | completed   |  62,046 |  62,046 |      0 | 61,969 |
| file  | show         | completed   |   2,962 |   2,238 |    724 |  1,802 |
| file  | show         | dropped     |       1 |       1 |      0 |      1 |
| file  | video_game   | completed   |      47 |       9 |     38 |      8 |
| file  | video_game   | dropped     |      37 |       0 |     37 |     20 |
| file  | video_game   | in_progress |       1 |       0 |      1 |      1 |
| file2 | anime        | completed   |  20,181 |  14,809 |  5,372 |  7,295 |
| file2 | anime        | dropped     |       2 |       2 |      0 |      2 |
| file2 | audio_book   | completed   |     497 |     445 |     52 |      6 |
| file2 | audio_book   | in_progress |      12 |       0 |     12 |     12 |
| file2 | book         | completed   |   4,667 |   4,267 |    400 |  2,582 |
| file2 | book         | in_progress |      22 |       0 |     22 |     22 |
| file2 | comic_book   | completed   |      26 |       1 |     25 |      0 |
| file2 | comic_book   | in_progress |       1 |       0 |      1 |      1 |
| file2 | manga        | completed   |  17,819 |  12,001 |  5,818 |  1,518 |
| file2 | manga        | dropped     |       5 |       5 |      0 |      0 |
| file2 | manga        | on_a_hold   |       4 |       4 |      0 |      0 |
| file2 | movie        | completed   |  41,989 |  34,715 |  7,274 |    174 |
| file2 | movie        | dropped     |       1 |       0 |      1 |      1 |
| file2 | movie        | in_progress |      56 |       0 |     56 |     56 |
| file2 | music        | completed   |      44 |      42 |      2 |     14 |
| file2 | podcast      | completed   |      51 |      51 |      0 |      0 |
| file2 | show         | completed   | 568,656 | 558,589 | 10,067 |    223 |
| file2 | show         | dropped     |       5 |       3 |      2 |      0 |
| file2 | show         | in_progress |     167 |       0 |    167 |    167 |
| file2 | show         | on_a_hold   |       1 |       0 |      1 |      0 |
| file2 | video_game   | completed   |     481 |     362 |    119 |     34 |
| file2 | video_game   | dropped     |       9 |       0 |      9 |      9 |
| file2 | video_game   | in_progress |      70 |       0 |     70 |     70 |
| file2 | video_game   | on_a_hold   |       2 |       0 |      2 |      2 |
| file2 | visual_novel | completed   |       1 |       0 |      1 |      0 |

Manual values below are exact sums of `manual_time_spent`, in seconds. All other type/state groups
have no recorded manual values, not a known zero. Of the ten completed game records in file2,
one has no finish date and contributes 18,000 seconds; all eleven in-progress game records have no
finish date. All other manual-time rows have a finish timestamp.

| Dump  | Media type | State       | Rows | Manual seconds |
| ----- | ---------- | ----------- | ---: | -------------: |
| file  | video_game | completed   |    2 |        110,820 |
| file2 | manga      | completed   |    3 |          4,680 |
| file2 | movie      | completed   |   25 |        194,640 |
| file2 | show       | completed   |    1 |          2,880 |
| file2 | video_game | completed   |   10 |     10,037,520 |
| file2 | video_game | in_progress |   11 |     14,013,420 |

###### Metadata basis coverage

Counts are seen rows whose joined legacy metadata has the stated basis. They are coverage counts,
not consumed totals. Positive, zero and absent remain separate; no negative bases were found in
these fields. Skeleton classification applies the complete current populated gate, including absent
specifics and Monitoring membership; custom entities are not skeletons. `Skeleton +` counts positive
bases that would be lost if capture read only the empty V2 parent properties.

| Dump  | Type / basis unit      | Seen rows | Positive |  Zero | Absent | Skeleton rows | Skeleton + |
| ----- | ---------------------- | --------: | -------: | ----: | -----: | ------------: | ---------: |
| file  | audio_book / minutes   |       117 |      117 |     0 |      0 |             1 |          1 |
| file  | book / pages           |       309 |      285 |    24 |      0 |             0 |          0 |
| file  | movie / minutes        |       668 |      668 |     0 |      0 |             1 |          1 |
| file  | music / seconds        |    62,046 |   61,720 |     0 |    326 |           327 |          1 |
| file2 | anime / episodes       |    20,183 |   17,594 | 1,372 |  1,217 |        11,227 |     10,787 |
| file2 | audio_book / minutes   |       509 |      508 |     0 |      1 |             9 |          9 |
| file2 | book / pages           |     4,689 |    3,451 |   944 |    294 |           517 |        281 |
| file2 | comic_book / pages     |        27 |        0 |     0 |     27 |            26 |          0 |
| file2 | manga / chapters       |    17,828 |   12,951 | 3,056 |  1,821 |         5,970 |      5,679 |
| file2 | manga / volumes        |    17,828 |   12,703 | 3,074 |  2,051 |         5,970 |      5,536 |
| file2 | movie / minutes        |    42,046 |   41,898 |    53 |     95 |           517 |        429 |
| file2 | music / seconds        |        44 |       26 |     0 |     18 |            17 |          0 |
| file2 | visual_novel / minutes |         1 |        1 |     0 |      0 |             0 |          0 |

File2 records anime positions on 20,167 completed and both dropped rows (two completed positions
are zero). Manga chapter positions exist on 17,755 completed, five dropped and four held rows;
volume positions exist on 442 completed rows only. No manga positions are zero. File has no anime
or manga rows. These recorded markers were not decremented, summed as consumption, or converted
between chapters and volumes.

Episode coverage joins each seen coordinate to its own parent's stored inventory, requiring
season/episode IDs. Distinct episode IDs at one coordinate would be ambiguous; none occurred.
Positive runtime requires one episode identity and one non-null runtime value. These source joins
do not substitute for the migration's provider-identity/latest-row resolution across parents.

| Dump  | Type / state        |    Rows | Unique coordinate | No coordinate | Positive runtime | Skeleton positive runtime | Specials |
| ----- | ------------------- | ------: | ----------------: | ------------: | ---------------: | ------------------------: | -------: |
| file  | show / completed    |   2,962 |             2,961 |             1 |            2,655 |                       311 |        2 |
| file  | show / dropped      |       1 |                 1 |             0 |                1 |                         0 |        0 |
| file2 | podcast / completed |      51 |                51 |             0 |               51 |                        51 |        0 |
| file2 | show / completed    | 568,656 |           542,723 |        25,933 |          487,387 |                   470,887 |    7,861 |
| file2 | show / dropped      |       5 |                 5 |             0 |                5 |                         4 |        0 |
| file2 | show / in_progress  |     167 |               122 |            45 |              116 |                       114 |        1 |
| file2 | show / on_a_hold    |       1 |                 1 |             0 |                1 |                         1 |        0 |

No resolved episode basis is zero. Missing coordinates and resolved coordinates without a positive
runtime must remain distinct. In particular, file2 has 25,978 source show coordinates without a
matching stored episode; later migration anomaly counts must account for these rather than hide them.

###### Fitness and measurement baselines

The following quantities are independent. Set duration converts minutes to seconds, rounding each
set to the existing three-decimal storage scale before summing. It is not added to active duration
or planned rest. Negative active durations remain unknown and must produce existing anomaly details.

| Measure                                     |               file |            file2 |
| ------------------------------------------- | -----------------: | ---------------: |
| Valid active-duration rows / seconds        |  1,241 / 7,795,653 | 646 / 12,097,906 |
| Negative active-duration rows               |                  1 |                2 |
| Null / zero active-duration rows            |              0 / 0 |            0 / 0 |
| Sets with duration / seconds                |    1,465 / 283,029 |    705 / 282,998 |
| Timed-kind sets missing duration            |                  0 |               60 |
| Untimed-kind sets without duration          |             39,451 |           10,330 |
| Recorded zero set durations                 |                 15 |               58 |
| Negative set durations                      |                  0 |                0 |
| Sets with planned rest / seconds            | 24,411 / 1,310,605 |  5,027 / 318,277 |
| Sets missing planned rest                   |             16,505 |            6,068 |
| Recorded zero planned rests                 |                  0 |                0 |
| Workouts with kcal / kcal total             |        0 / unknown |          2 / 289 |
| Workouts missing kcal                       |              1,242 |              646 |
| Negative / zero energy rows                 |              0 / 0 |            0 / 0 |
| Measurement entries / named readings        |          224 / 224 |          62 / 75 |
| Empty measurement entries                   |                  0 |                0 |
| Multi-reading entries / maximum readings    |              0 / 1 |            6 / 5 |
| Distinct owner/normalized metric keys       |                  2 |               24 |
| Readings with preference unit / without     |           201 / 23 |          31 / 44 |
| Zero / missing measurement values           |              0 / 0 |            0 / 0 |
| Duplicate normalized reading keys per entry |                  0 |                0 |

Both recorded energy values use the kcal preference/default. In file2 all 60 missing timed-set
durations belong to the `duration` kind; its 114 `distance_and_duration` sets all have duration.
Measurement entries use the original `(user_id, timestamp)` boundary, not timestamp alone.

###### Enabled-account scale

Enabled means `is_disabled IS NOT TRUE`, matching migration behavior. Rankings disclose only sizes.

| Measure                                       |       file |                                  file2 |
| --------------------------------------------- | ---------: | -------------------------------------: |
| Enabled / disabled accounts                   |      1 / 0 |                               69 / 230 |
| Enabled / disabled seen rows                  | 66,188 / 0 |                      145,898 / 508,871 |
| Enabled / disabled accounts with seen rows    |      1 / 0 |                                45 / 98 |
| Largest enabled seen histories, descending    |     66,188 | 24,771; 21,967; 14,670; 11,909; 11,302 |
| Enabled / disabled workouts                   |  1,242 / 0 |                              350 / 298 |
| Enabled / disabled workout sets               | 40,916 / 0 |                          5,870 / 5,225 |
| Largest enabled workout histories, descending |      1,242 |                    113; 68; 54; 43; 24 |

The owner-approved query targets are p95 ≤500 ms for a normal period and ≤2 s for all time over
100,000 observations. No enabled source account reaches 100,000 independent seen rows. The Media
owner handles the query prototype and synthetic scale coverage; no query-performance acceptance
is claimed by this inventory.

##### Media source evidence and implemented mapping

- `seen-mapping.ts` no longer expands `updated_at` or interpolates percentages. V1 keeps
  only the final `progress`, not an amount per update. `crates/utils/dependent/progress/src/lib.rs`
  appends update timestamps for both progress and state changes. Timestamps therefore cannot prove
  intermediate amounts or consumption dates.
- V1 stores `manual_time_spent` in seconds; the edit-history UI converts duration inputs to seconds.
  The adapter writes cumulative minutes on the source fact, including partial progress and resolved
  show/podcast completions. Parent terminal status does not repeat the resolved child's manual time.
- `started_on` and `finished_on` are nullable timestamps. V1 explicitly supports completed records
  without dates. Available timestamps remain ordering/start evidence. All migrated source facts use
  `dateUnknown: true`; the README's claim that V1 completion dates are always known has been removed.
- V1 has no date-precision discriminator or source-import identity on `seen`. Date-only importers
  use `convert_naive_to_utc` in `crates/utils/common/src/lib.rs`, which writes UTC midnight. The UI
  also accepts custom dates and stores UTC timestamps. Midnight alone cannot prove original date
  precision, and a non-midnight timestamp alone cannot prove an exact consumption observation.
  Preserve available evidence without claiming that discarded precision can be recovered.
- `metadata-mapping.ts` owns the populated gate. Monitoring titles, all podcasts, and non-TMDB shows
  remain skeletons even when V1 has useful specifics. Historical estimates must join legacy
  `metadata` directly before `drop-tables.ts`, not rely only on migrated entity properties.
- Source estimation fields: `audio_book_specifics.runtime` and `movie_specifics.runtime` are minutes;
  `music_specifics.duration` is seconds; `visual_novel_specifics.length` is minutes;
  `book_specifics.pages` and `comic_book_specifics.page_count` are pages;
  `anime_specifics.episodes`, `manga_specifics.chapters`, and `manga_specifics.volumes` retain their
  separate units. Game time-to-beat is not consumption evidence.
- Episode runtimes live in `show_specifics.seasons[].episodes[].runtime` and
  `podcast_specifics.episodes[].runtime`. `episodic-sub-entity-mapping.ts` and
  `episode-resolution-sql.ts` already resolve episode identities and ambiguous/missing positions.
  Use that resolution when freezing a legacy episode basis.
- Partial numbered Anime/Manga evidence retains the original position and percent as `sourceProgress`;
  no subtraction is applied. Volume-only partial evidence uses unit `volumes`. Numbered completed
  items create independent `item-complete` events; optional chapter volume is context only. Completed
  Manga fractions remain exact numeric values. Source rows are never deduplicated.

##### Completion-cycle audit

Removing interpolated measurements is not an isolated row deletion:

1. Show/podcast `progress` reopens a covered episode during `seen-completion-mapping.ts` replay.
   Every explicit episode completion has its own deterministic source-row identity. Regular episodes
   use the parent session; specials stay sessionless. Parent completions close full regular coverage,
   then clear it for a repeat. Parent status must be ended/canceled; empty coverage cannot complete.
2. Anime/manga progress-to-title inference and equal-or-later completion suppression are removed.
   Supported explicit completions retain independent deterministic source-row identities. Numbered
   items use `item-complete`, with no synthetic baseline, cumulative fields, or `completionKey`.
3. Completion ordering uses finish time where present and the last update otherwise. Creation time
   retains the last update; terminal statuses sort after their partial child baseline. Unknown-date
   classification remains separate from deterministic ordering.
4. Parent completions carry `completionKey`, `completionSilent: true`, an episode-only basis, and
   frozen `completion-occurrence`/`completion-episode` evidence on the owner's Media Library. Their
   effective order uses the closing child's `~parent` suffix. No child duration is repeated.

Source facts and parent evidence have separate atomic report guards. Restart does not overwrite
completed phases. Canonical correction-worker execution still needs real acceptance.

##### Fitness evidence and adapter seams

- `exercise-taxonomy-mapping.ts` maps `exercise.muscles[]` and `exercise.equipment` to typed standard
  target/equipment entities and exercise relationships, using exact active plugin/provider identity.
  `e_z_curl_bar` normalizes to `ez_curl_bar`. Legacy muscle roles are absent, not inferred.
- `migrate-data.ts` creates taxonomy before workouts and invokes `workout-taxonomy-mapping.ts` after
  set conversion. It writes one `workout-exercise` per zero-based position in `information.exercises[]`.
- Workout exercise objects in both dumps contain `id`, `lot`, `unit_system`, notes, sets and totals;
  they contain no muscle/equipment snapshot. Available provenance is the legacy exercise assignment
  at export time, not proof of its assignment when the historical workout occurred.
- Snapshots retain typed target/equipment references, null roles, and `provenance: legacy` within the
  canonical 100-item array bounds. Repeated exercises remain separate. Templates create no snapshots.
  Occurrence ordering uses workout start, never a claim about timed set evidence. Assertions check
  ownership, recorded kind, taxonomy identity, deterministic output, and each source set's join.
- `buildWorkoutSetEventMigrationSql` preserves occurrence order and recorded `exerciseKind` from
  the workout JSON, then converts weight/distance to kg/km and duration to seconds. It keeps
  `confirmedAt`, but falls back to workout start for event ordering when confirmation is absent.
  Hourly set metrics must not treat that fallback as a timed observation.
- Active duration comes from V1 workout `duration` in seconds, independently of set duration and
  planned rest. Existing invalid duration/energy handling and report guards must remain intact.

#### Mapping milestone and remaining gates

Fitness's exact occurrence contract is integrated. Media's source facts and frozen parent correction
evidence are integrated. `sourceRun: seen:<id>` preserves independent source identity; frozen bases
come from legacy metadata before it is dropped, including skeleton parents. No runtime capture or
notification hooks are replayed.

The finalized Media handoff is integrated: Anime/Manga `item-complete` uses
`consumedItem: { unit, position, volume? }`, one event per original numbered completion. Anime positions
are nonnegative integers; Manga positions and completed chapter volume context retain fractions.
Volume-only items use unit `volumes`, while retaining the target's normal chapter basis. Partial
volume-only rows use noncontributing `sourceProgress`. Partial chapter volume context uses the existing
integer `mangaVolume` field; fractional context fails explicitly because that schema cannot retain it.
Unpositioned explicit completed rows remain whole-title completions. Unpositioned Anime/Manga
in-progress rows at 100 percent fail explicitly rather than implying an unsupported title completion.
Active-schema resolution now requires `item-complete` on both Anime and Manga before conversion.

Supplementary rollback-only PostgreSQL fixtures passed six Fitness cases (repeated positions and
restart, missing taxonomy, identity conflict, set mismatch, missing exercise, overflow) and four Media
cases (facts/independent completions/parent evidence/restart, then-current numbered-item guard, invalid percent,
missing target). Each used a temporary fixture schema in disposable `postgres` and rolled back; neither
restored source database was modified. These cases do not establish real-dump or startup acceptance.
Changed-file Oxlint passed for the five mapping/orchestration TypeScript files. No package or
repository validation was run, as requested.

After the finalized handoff, nine changed-mapping SQL cases passed: a 512-row positive fixture covering
503 repeated item numbers across the batch boundary, zero, fractional chapters and volumes, context,
manual minutes, partial/held/dropped volume evidence, explicit whole-title completion and restart;
and explicit aborts for fractional Anime, negative/nonfinite/malformed Manga, fractional partial
chapter context, ambiguous unpositioned percent, null state, and deterministic output conflicts.
All 512 generated events also passed the current manifest schemas and canonical allocator: 505
episodes, one chapter, and one volume from 507 item events, with zero item-derived title completions.
Manual values and unknown-date attribution remained intact; partial positional evidence contributed
no item quantity. These were rollback-only fixtures, not real-dump migrations or persisted active-schema
acceptance. The owner separately reported 62 focused Media tests passed; those tests were not rerun here.

A read-only source query after handoff established file2's exact numbered completion expectations:
20,167 Anime episodes, 17,755 Manga chapters, and 59 volume-only Manga items (37,981 item events).
There are 14 unpositioned explicit Anime completions and five Manga completions, and zero ambiguous
unpositioned 100-percent in-progress or partial volume-only rows in that source. Fractional/partial
volume behavior therefore has supplementary fixture coverage, not demonstrated real-dump coverage.

Real migrations, active-schema checks, interrupted and completed restarts, normal-startup correction,
disabled-account checks, retention/restore, asset verification, and query timings remain pending.
No canonical mapping contract answer remains pending. The Media production processor/readiness and
writer audits must finish, and the orchestrator must authorize stable builds and acceptance before
the deferred commands below run. Full file2 asset acceptance still lacks its 107 original objects.

#### Disposable resources

Created only for this task, with Docker label `ryot.acceptance=order16` and network
`ryot-order16-acceptance`. Existing containers were untouched. All published ports bind loopback.

| Resource                     | Location                                                      |
| ---------------------------- | ------------------------------------------------------------- |
| PostgreSQL 18                | `ryot-order16-postgres`, `127.0.0.1:32778`                    |
| Original restored sources    | `order16_file_source`, `order16_file2_source`                 |
| Redis                        | `ryot-order16-redis`, `127.0.0.1:32779`; PING returned PONG   |
| S3-compatible storage        | `ryot-order16-storage`, `http://127.0.0.1:32777`              |
| Separate destination buckets | `order16-file`, `order16-file2`                               |
| Asset staging helper         | `ryot-order16-assets`, `/staging`; helper sleeps for 24 hours |

Disposable PostgreSQL credentials: user `postgres`, password `order16-disposable`.
Disposable S3 credentials: access key `order16-disposable`, secret `order16-disposable-secret`,
region `us-east-1`. Each bucket contains 58 cached objects totaling 284,336,460 bytes from the
runbook's existing `/tmp/ryot-bucket` cache. No remote bucket was modified or contacted.

##### Source asset coverage and blocker

All source JSONB columns were scanned recursively for `s3_images` and `s3_videos` using strict
JSONPath; the denormalized collection-membership view was excluded. Only the source fields below
contain those locators. Exact, case-sensitive keys were compared with the disposable bucket listing.
Each listed reference is a distinct key in these dumps, including across source fields.

| Dump  | Source field        | Source keys | Staged | Missing |
| ----- | ------------------- | ----------: | -----: | ------: |
| file  | exercise.assets     |          30 |     30 |       0 |
| file  | workout.information |          13 |     13 |       0 |
| file2 | exercise.assets     |          50 |      0 |      50 |
| file2 | metadata.assets     |          56 |      0 |      56 |
| file2 | workout.information |           1 |      0 |       1 |

File has 43/43 keys present and 15 additional staged objects. File2 has **0/107 keys present**;
its matching object backup is a real blocker for full asset acceptance. Of those missing keys,
46 exercise and 55 metadata locators belong to owned custom rows, and one belongs to a workout:
at least 102 owned locators lack bytes. Four custom-exercise locators and one custom-metadata locator
have no source owner; their normal migration ownership/omission rules still need validation.
Do not fill missing keys with substitute content or describe unresolved-locator reports as successful
asset preservation. Presence for file is not yet content-hash/managed-asset migration acceptance.

###### File-only seed and owner decision (2026-10-28)

Executed `just --justfile /private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-sync-s3.just sync-s3`
with the local endpoint redirected to `ryot-order16-storage` and destination `order16-file`. The
recipe reused `/tmp/ryot-bucket`; its 58 objects (284,336,460 bytes) remained unchanged. The
destination retained 58 objects (284,336,460 bytes), passed the empty sync dry-run, and contains all
43/43 `file.sql` asset keys. `order16-file2` retained the same object count, byte total, and manifest
as before the run. The original remote `ryot` bucket was listed read-only; no remote writes or
downloads occurred. The temporary recipe was removed after the run.

Owner decision: the `file2` object backup is unavailable. Full `file2` asset acceptance remains
blocked; continue data-only validation without substitute assets.

Missing-key extension counts (case folded): exercise has 40 extensionless, five JPG, three PNG and
two WebP; metadata has 43 extensionless, twelve JPG and one JPEG; the workout key is extensionless.
For exact set comparison without publishing filenames or user identifiers, SHA-256 of sorted unique
UTF-8 keys joined by LF with a final LF is:

| file2 missing source | Key-set SHA-256                                                    |
| -------------------- | ------------------------------------------------------------------ |
| exercise.assets      | `192b045b46ef11f5e4f296289409224e582963a6f3601bcf68d98f811418be5c` |
| metadata.assets      | `babf221a2239bed37d46bae71a8ed387693d8ad71c9e2e195805e7a55f4188ee` |
| workout.information  | `57223234c08154543f77271e02d6644d91ef6bf4645e0c1496275163b9bf9221` |

Exact locators remain available in the isolated source DB. For each listed JSONB field, enumerate
`jsonb_path_query(field, 'strict $.**.s3_images[*]', '{}', true)` and the corresponding `s3_videos`
path, extracting the scalar with `#>> '{}'`. No remote asset recovery was attempted.

Keep the source databases intact for comparisons. The parent already created both unused targets
from those templates; do not recreate or drop them. Use Redis database 0 for the first dump and 1 for
the second. Select the matching S3 bucket. Export all of these explicitly for migration and normal
startup:

- `DATABASE_URL`
- `REDIS_URL`
- `FILE_STORAGE_S3_URL`
- `FILE_STORAGE_S3_REGION`
- `FILE_STORAGE_S3_BUCKET_NAME`
- `FILE_STORAGE_S3_ACCESS_KEY_ID`
- `FILE_STORAGE_S3_SECRET_ACCESS_KEY`

Do not use the repository's `just restore-db` or `just sync-s3` against working services. The
migration asset pass can delete copied legacy keys, so each dump needs its own seeded bucket.

#### Deferred execution commands

On 2026-10-29, after confirming both names were unused, the two fresh disposable targets below were
successfully created from the preserved source databases. The source databases remain unchanged.
Clone preparation is complete: **do not recreate these existing targets or drop them**. No migration,
normal startup, archive build, or server assembly has run.

Run the remaining commands only after the orchestrator confirms production audit completion and
authorizes builds. Use the repository root for the build; assembly uses `apps/server` as its working
directory. Record separate build, assembly and migration wall times. Reuse artifacts between dumps.
The parent owns the global check before building. Freeze all artifact inputs with their owners first;
if an input changes, stop and coordinate a rebuild before reusing the artifacts. The exact private
execution checklist and per-phase log paths are in the kit's `execution-readiness.md`.

```bash
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" BUN_OPTIONS=--no-env-file \
  bun --no-env-file turbo --env-mode=loose --filter=@ryot-app/media-plugin --filter=@ryot-app/fitness-plugin --filter=@ryot-app/sandbox --filter=@ryot-app/kernel-backend --filter=@ryot-app/kernel-renderers --filter=@ryot-app/kernel-client --filter=@ryot-app/server build
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" BUN_OPTIONS=--no-env-file \
  bun --no-env-file --cwd apps/server run assemble
```

The client build is explicit; assembly builds the shared client runtime and compiles every shipped
kernel renderer, including Analytics. `BUN_OPTIONS` disables automatic env-file loading in nested Bun
commands as well as the outer command. Turbo's loose env mode passes this clean environment to child
tasks; it does not disable caching. No working-service environment is inherited.

These are the successfully executed clone-preparation commands, retained for reference only. Do not
run them again against the existing targets.

```bash
docker exec ryot-order16-postgres createdb -U postgres -T order16_file_source order16_file_migrated
docker exec ryot-order16-postgres createdb -U postgres -T order16_file2_source order16_file2_migrated
```

In one shell, set up an isolated runtime invocation. `env -i` and `--no-env-file` exclude working-service
credentials. Local storage, temporary files and logs are separate per dump. The function's second
argument selects migration-only or normal startup. Ports 32780/32781 must be free before normal startup.

```bash
ROOT=/Users/diptesh/Desktop/Personal/ryot
ACCEPTANCE=/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-runtime
mkdir -p "$ACCEPTANCE/file/storage" "$ACCEPTANCE/file/work" "$ACCEPTANCE/file2/storage" "$ACCEPTANCE/file2/work"

order16_run() {
  local dump="$1" migration_only="$2" redis_db port
  case "$dump" in
    file) redis_db=0; port=32780 ;;
    file2) redis_db=1; port=32781 ;;
    *) return 2 ;;
  esac
  env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" BUN_OPTIONS=--no-env-file \
    DATABASE_URL="postgresql://postgres:order16-disposable@127.0.0.1:32778/order16_${dump}_migrated" \
    REDIS_URL="redis://127.0.0.1:32779/$redis_db" \
    FILE_STORAGE_S3_URL=http://127.0.0.1:32777 \
    FILE_STORAGE_S3_REGION=us-east-1 \
    FILE_STORAGE_S3_BUCKET_NAME="order16-$dump" \
    FILE_STORAGE_S3_ACCESS_KEY_ID=order16-disposable \
    FILE_STORAGE_S3_SECRET_ACCESS_KEY=order16-disposable-secret \
    FILE_STORAGE_LOCAL_DIR="$ACCEPTANCE/$dump/storage" \
    FILE_STORAGE_LOCAL_TEMP_DIR="$ACCEPTANCE/$dump/work" \
    SERVER_ADMIN_ACCESS_TOKEN=order16-disposable-local-admin \
    SERVER_LOG_FILE="$ACCEPTANCE/$dump/server.log" \
    SERVER_PLUGINS_SYSTEM_DIR="$ROOT/apps/server/plugins" \
    SERVER_CLIENT_DIR="$ROOT/kernel/client/dist" \
    SERVER_DISABLE_NOTIFICATIONS=true SCHEDULER_DISABLE_DISPATCHERS=true \
    FRONTEND_URL="http://127.0.0.1:$port" PORT="$port" TZ=UTC \
    DISABLE_TELEMETRY=true RUN_MIGRATION_ONLY="$migration_only" \
    bun --no-env-file --cwd "$ROOT/apps/server" run src/main.ts
}

order16_run file true > "$ACCEPTANCE/file/migration.log" 2>&1
order16_run file2 true > "$ACCEPTANCE/file2/migration.log" 2>&1
```

`SERVER_ADMIN_ACCESS_TOKEN` is required by current configuration, including migration-only startup.
Its disposable value above must never be reused outside this loopback validation. Notification
delivery and automatic cron dispatch are disabled to avoid using copied delivery/integration settings;
projection and correction workers remain enabled. These isolation settings do not replace the
migration-silence, enabled/disabled-account, or readiness gates.

Inspect each exit status and log before proceeding. Any unexpected source-state abort is a failed
conversion, not a documented omission. After each first successful run, snapshot reports and canonical event
IDs/properties/order fields, then run the same target again:

```bash
order16_run file true > "$ACCEPTANCE/file/restart.log" 2>&1
order16_run file2 true > "$ACCEPTANCE/file2/restart.log" 2>&1
docker exec ryot-order16-postgres psql -X -U postgres -d order16_file_migrated -c 'TABLE migration_report;'
docker exec ryot-order16-postgres psql -X -U postgres -d order16_file2_migrated -c 'TABLE migration_report;'
```

Run normal startup separately for each target and stop that foreground process after reconciliation:

```bash
order16_run file false
# After file reconciliation and stopping its process:
order16_run file2 false
```

An interrupted-phase restart needs another unused clone and a separately seeded bucket, because a
completed asset pass can remove legacy keys. Keep completed targets and their comparison snapshots.

#### Verification metrics for the real runs

| Gate                                                                         |      file |    file2 |
| ---------------------------------------------------------------------------- | --------: | -------: |
| Source seen rows to reconcile against output or documented episode anomalies |    66,188 |  654,769 |
| Numbered Anime/Manga item events                                             |         0 |   37,981 |
| Unpositioned explicit Anime/Manga title completions                          |         0 |       19 |
| Source manual minutes, counted once per source row                           |     1,847 |  404,219 |
| In-progress manual minutes                                                   |         0 |  233,557 |
| Workout occurrence events                                                    |    10,768 |    4,003 |
| Workout set events                                                           |    40,916 |   11,095 |
| Workout completion events                                                    |     1,242 |      648 |
| Measurement entries / readings                                               | 224 / 224 |  62 / 75 |
| Enabled / disabled users                                                     |     1 / 0 | 69 / 230 |
| Original asset keys available                                                |   43 / 43 |  0 / 107 |

These are source expectations, not measured destination results. Compare exact source/destination
sets by owner and source identity, not only counts. Reconcile any reported unresolved episode's
consumption separately; do not silently subtract it from the source baseline. In particular:

- No interpolated quantities, numbered-item-to-title inflation, inferred exact hours, or parent
  duplicate duration. Check zeros and missing quantities separately. Freeze skeleton metadata bases
  and retain all explicit repeats, fractional chapters and volume evidence through `item-complete`.
- Every source set joins exactly one occurrence by plugin, owner, workout, exercise and order; kinds
  match the saved workout JSON. Taxonomy arrays match export-time assignments with null legacy roles.
- Decode migrated properties and typed references against the persisted active schemas, including
  correction evidence. Require zero schema failures, reference failures and deterministic conflicts.
- Compare event IDs, complete properties, effective order, and phase reports across completed restart.
  Exercise interrupted restart independently; completed phases must preserve later edits/suppression.
- After normal startup, wait for enabled library projections to become ready; compare live summaries
  and canonical facts. Correction must preserve frozen evidence and independent occurrences. Disabled
  accounts must run no plugin work. Check notification and automation-history counts after migration.
- Verify managed-asset byte hashes and ownership for file. Record file2 unresolved locators explicitly;
  its unavailable 107 objects remain outside data-only acceptance. Exercise reference remapping and
  frozen-evidence retention through the coordinated backup/restore acceptance.
- Record p95 ≤500 ms normal-period and ≤2 s all-time queries at 100,000 observations with the Media
  owner's prototype. The largest enabled real histories are only 66,188 / 24,771 source rows; record
  synthetic-scale evidence separately. No performance result is claimed here.

#### Reproducible read-only acceptance kit (2026-10-29)

The prepared kit is at
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-acceptance-kit`.
This exact directory was verified against the environment. Its `README.md` describes the queries,
scope, privacy rules, expected exit codes, and deferred execution sequence. Its acceptance commands
perform no PostgreSQL or object-storage writes. PostgreSQL export connections use both
`default_transaction_read_only=on` and explicit repeatable-read/read-only transactions. S3 uses signed
GETs against the fixed disposable loopback endpoint. Local private SQLite/JSON/gzip artifacts are the
only data written. Console output contains aggregate counts and fingerprints, not source identifiers.

`source.sql.json` and `expected.py` reconstruct source expectations independently of the migration
SQL. `accept.py compare` performs exact ID/property/ownership/logical-order joins, rejects extra
canonical events, checks source-run multiplicity and manual minutes once per run, reconciles unresolved
episode identities with report details, verifies Fitness kind/taxonomy/provider/metric values, and
checks nested typed references. Parent completions and every frozen supporting episode are compared
separately. `validate.mjs` validates properties against destination-persisted active schemas.
`gates.py` covers migration notification/automation silence and enabled/disabled runtime work/readiness.
`assets.py` proves original byte hashes, permanent owner namespaces, registrations, owning references,
and destination bytes. Full file2 asset verification remains blocked rather than returning success.

##### Preparation actually run

- Source SELECTs executed read-only against both preserved databases. Complete private source captures
  and symbolic expected-event inventories were produced. No destination query or migration was run.
- File2's first capture exceeded a 120-second command timeout. Its incomplete **local** SQLite capture
  was retained as `file2/interrupted-source.sqlite`; a fresh capture completed with a 600-second timeout.
  That incomplete file is never used by the comparison commands.
- Exact source-derived baselines match 37,981 file2 numbered items, 19 unpositioned Anime/Manga title
  completions, 10,768 / 4,003 workout occurrences, and 40,916 / 11,095 sets. Source manual minutes are
  1,847 / 404,219 across 2 / 50 source rows. Expected omitted episode identities are 1 / 25,978.
- Original asset GETs hashed all 43 file keys before any migration deletion. All 107 file2 keys returned
  unavailable. The captures retain content type, byte size, SHA-256 and original ownership references.
- Python AST and query-JSON syntax checks passed. The standalone persisted-schema validator imported
  successfully and rejected an empty input with exit 1, proving an empty export cannot pass.
  Destination SELECT execution, real persisted-schema validation, exact comparisons, restart gates,
  runtime readiness and managed-destination byte checks remain deferred.

| Prepared fingerprint                   | file                                                               | file2                                                              |
| -------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Exact source seen rows                 | `b6b71e06d3d6595aa9f9f71cfb168da67819bac9f49ffd7cbcff1310d08e7918` | `07ff70bfa4c196f5b5c6be2340b5ccfd0438e1bae54003914bc6521f188e7a0c` |
| Exact source workout rows              | `3bea2607b251b815757b91805744a4ad445cc6c6af553475f13dc8176a945ee2` | `44ee2c8e70f552312eb44228609828d560a838a71aa34031984e407ca6f10e16` |
| Original asset byte/ownership manifest | `a345e0303cc95861c1651bcd0cd40c5d6e0f95ce785f8e657c1662985a7fc66e` | `762c5e4804f92e05d6aa86c25bc026cfebf1064c08a7065044cb8cf71c5537c6` |

The complete per-table and symbolic expectation fingerprints are in each dump's `source-summary.json`;
asset evidence summaries are in `source-assets-summary.json`. Symbolic plugin/provider names make the
source expectations deterministic before destination installation IDs exist. Comparison rebuilds the
expected identities using the exact destination active plugin/provider bindings. These fingerprints
are preparation evidence, not successful destination acceptance.

##### Commands for the parent after authorization

Keep the application stopped during each cross-table snapshot. Use fresh labels; existing local
captures are rejected. These commands only read the already-migrated destination; they do not perform
the build, migration, restart, or normal startup. Run only after the parent separately authorizes and
completes those operations. The same sequence applies to `file2` with its own directory and database.

```bash
KIT=/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-acceptance-kit
python3 "$KIT/accept.py" snapshot file migrated
python3 "$KIT/accept.py" compare file migrated
bun --no-env-file "$KIT/validate.mjs" "$KIT/file/migrated-validate.jsonl.gz"
python3 "$KIT/gates.py" file migration
python3 "$KIT/assets.py" verify file migrated

# After an authorized migration-only restart has exited:
python3 "$KIT/accept.py" snapshot file restarted
python3 "$KIT/accept.py" stability file migrated restarted

# During authorized normal startup, after reconciliation:
python3 "$KIT/gates.py" file runtime
# After stopping that process:
python3 "$KIT/accept.py" snapshot file reconciled
python3 "$KIT/accept.py" runtime-stability file restarted reconciled
```

Migration-only stability requires identical event IDs/properties/effective order and complete report
and detail hashes. Runtime stability checks original source facts and workout events plus reports,
excluding mutable correction checkpoints/run state and newly derived outputs. Exact live summary
equivalence, performance and backup/restore remain runtime-owner gates; readiness alone cannot prove
them. File2 asset verification exits 2 for its unavailable source bytes; this remains a full-asset
blocker even when all data-only comparisons pass.

##### Final canonical event-group alignment

The finalized contract stores declaration metadata in `definition_event_schema.event_group`.
`20261028192959_event_groups` updates definitions and views; it introduces no event-row column.
Fitness anchors are unique by user/plugin/session/`exerciseOrder`, including across different
exercises. Every anchor requires at least one `workout-set`, and every set requires exactly one anchor
matching user, plugin, session, exercise, order and kind. The declaration makes session, kind, targets,
equipment and provenance immutable.

The final mapping change is limited to `workout-taxonomy-mapping.ts`: its existing source validation
uses a JSON-type `CASE` before `jsonb_array_length` and explicitly rejects empty or malformed set
inventories. The operator message requires corrected V1 evidence and a fresh restored copy, and says
not to invent sets or silently skip positions. The parent checked the preserved sources read-only:
file has **0 empty positions / 10,768**, and file2 has **0 / 4,003**. A separate read-only scan of the
retained local captures confirms those totals and zero malformed inventories. Expected counts do not change.

The private kit's `expected.py` rejects empty/non-array source sets. `accept.py` captures persisted
`event_group`, requires the exact Fitness declaration, exports grouped schemas for `validate.mjs`,
and includes schemas in restart hashes. The validator uses `PluginEventGroup` and
`pluginEventGroupIssue`. `group-consistency.sql` checks generic declared groups for duplicate keys,
invalid keys/sessions, unmatched or ambiguous dependents, and orphan anchors in both gate phases.
The historical restore owner must also run this query after event copying and before legacy table
removal/restore acceptance, with all failure counts zero. Kernel-owner tests cover mutation enforcement.

Focused verification passed: changed-file format/lint and Python/query syntax; **8 mapping rollback
cases**, **12 generic group rollback cases**, and **4 validator export cases**. The controlled mapping
cases cover valid repeated positions and empty, missing, null, object, string, number and boolean set
inventories. Group cases cover valid groups, missing anchors/sets, duplicate keys across exercises,
mismatched exercise/kind/order/session/owner/plugin, missing keys and null sessions. All SQL fixtures
used isolated schemas in disposable `postgres` and rolled back; none used a source or target database.
The reusable fixture command is `python3 "$KIT/group-fixtures.py"`.

This mapping and kit are ready for authorized build/migration against the canonical constraints.
The parent reports the kernel event-group scope passed 223 tests in 15 files through split runs, with
type/lint checks passing and no known failure in that scope. The earlier combined run had 21
fixture/load failures; subsequent lifecycle (24), service (60), and remaining-file (139) runs passed.
This is reported scoped evidence, not a consolidated backend, review, or E2E result. Stable-source
coordination, the parent's global check, remaining owner integration gates, and explicit authorization
still gate execution. Actual destination
queries, schema validation, restart/runtime checks, and destination asset proof remain unrun; file2's
107 unavailable original assets still block full asset acceptance. No targets, source databases,
dumps or object storage changed during this alignment.

##### Execution-readiness inspection (2026-10-29)

Current Media declarations contain the mapped frozen basis, `dateUnknown`, `calendarDate`, minutes,
source identity, numbered item payload, and parent correction fields. The legacy sources still prove
unknown consumption dates, so the mapping must not fill `calendarDate` from ordering timestamps.
Current Fitness declarations and the private group's exact expected declaration agree; event-group
metadata adds no event-row column. No mapping/schema blocker was found in this bounded inspection.
Static field coverage passed for 48 current Media event schemas and the parent correction fields.

Two preparation defects were corrected without executing a build or touching a target. The isolated
run command now supplies the required disposable admin token and built client directory. The private
schema validator now rejects any successful parse that removes, adds, or normalizes persisted
properties. This closes a false-positive path: non-strict schemas can silently strip an undeclared
canonical field. Property-schema validation still does not establish allocator semantics, live summary
equivalence, performance, or backup/restore behavior. Those remain their owners' gates.
Four focused private validator cases passed: five valid canonical records, and rejection of stripped
fields, decoded rounding, and added defaults. No PostgreSQL fixture or earlier passed proof was rerun.
Changed Markdown formatting, JavaScript/Python syntax and standalone private-kit lint passed. The
repository's production lint rules reject the external CLI's existing Node import/object ordering;
that separate invocation did not pass and no suppression was added. No repository-wide check ran.

### B. Fitness analytics query gate evidence

Moved from `plugins/fitness/README.md`.

The first section dataflow is ready in `client/analytics/queries.ts`:

- Summary tiles use `analyticsSummaryQuery({ reference: owner, selection, timeZone, filter })`.
  It captures one execution clock for current and actual previous-period totals. The previous query
  uses the resolver's calendar dates, including DST changes, and is omitted for all-time or disabled
  comparisons. The result is `{ current, previous }`, with `previous: null` when unavailable.
  Each totals document has five named queries, ten across a comparison. Each document owns its
  repeatable-read snapshot; the comparison does not share one snapshot across both requests.
- The selected metric uses `analyticsTrendQuery` with `period: "current"` and, when enabled,
  `period: "previous"`. Chart inputs retain each response's actual period, unit, null values and
  `hasMore`; comparison labels must not replace the previous dates with current dates.
- Hours use `workoutStartsByHourQuery`. Rankings use `analyticsRankingQuery`; drilldowns use
  `analyticsWorkoutsQuery` or `measurementReadingsQuery`. These page results are ready for SDK
  cursor pagination. Selection, timezone, owner or filter changes start a new pagination selection.
- Each selected measurement metric uses `measurementTrendQuery`; unit-bearing series stay separate.
  Summary, trend, ranking and drilldown loading/error states remain independent. The Fitness
  contribution is registered in the manifest and implements summary tiles, charts, rankings,
  workout/measurement drilldowns, and the Home Analytics link. Broader interaction work remains
  active; the scoped query and chart results below do not establish complete UI acceptance. The
  Fitness package check passed 26/26, and its latest package test run passed 636/636 tests across 98
  files in one Turbo task (20.621 seconds). Six affected shared client packages passed checks
  (11 tasks) and tests (6 tasks); `@ryot-app/server` passed `check --only` as one task. The browser
  smoke is authored. An earlier E2E package check passed before a newer interaction test was added;
  the current E2E package check has one type error in
  `fitness-analytics-interactions.test.ts` (native/wrapper locator), and the owner fix is active.
  No current-checkpoint E2E runtime has run.

#### Local SQL-plus-decode query gate (2026-10-29)

The current local SQL-plus-decode gate **passes** all 20 recipe cases against the unchanged 500 ms
rolling and 2,000 ms all-time warm-p95 limits. Each case has 20 finite warm samples; p95 is the
19th sorted sample (zero-based index 18). The cold sample is excluded. The per-case p95s are:

| Recipe            | Rolling warm p95 (ms) | All-time warm p95 (ms) |
| ----------------- | --------------------: | ---------------------: |
| Equipment         |             46.461792 |             477.517792 |
| Exercises         |             32.794084 |             218.782833 |
| Hours             |             20.427250 |              16.345375 |
| Measurements      |              1.308250 |              12.227500 |
| Reading drilldown |              1.385875 |               9.467333 |
| Targets           |            362.813459 |           1,218.724083 |
| Totals            |            133.862584 |             649.630167 |
| Volume            |             44.864500 |             312.259167 |
| Workout drilldown |             19.543167 |              12.826458 |
| Workouts          |             19.604750 |              13.942792 |

The worst warm p95s are rolling targets at **362.813459 ms** and all-time targets at
**1,218.724083 ms**. Rolling targets' first sample was **501.395500 ms**; it is not a warm-gate
failure. All 20 decoded results match exactly: nine compare with aligned diagnostic baselines and
11 with earlier coordinated successful baselines. Source-before and source-after maps match, and
the current file hashes match all **199/199** captured paths.

The schema-aligned synthetic fixture contains 100,000 sets, 20,000 occurrence anchors, 10,000
workouts, 20,000 readings, 10,000 measurement entries, 100 exercises, 10 targets, and five equipment
entities. It spans 1,000 days. The clone added only `entity.content_generation`
(`integer NOT NULL DEFAULT 1`); indexes and old columns/rows were preserved. PostgreSQL 18.6 used unchanged defaults,
including 30-second statement timeout, JIT enabled, and 4 MiB `work_mem`.

This verifies local SQL plus decode only. It does not cover HTTP, iframe, ordinary writers, or
publication at scale, and does not establish whole Fitness UI acceptance. Evidence:
`fitness-schema-aligned-20261029/warm-gate-typed-path-current-a`,
`fitness-schema-aligned-20261029/warm-gate-verification-20261029/VERIFICATION.md`, and
`fitness-schema-aligned-20261029/warm-gate-verification-20261029/summary.json` under the approved
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/` directory.

##### Reporting-charts iframe suite (2026-10-29)

The earlier targeted suite passes **1/1** after test-only assertion fixes. It covered all eight visual modes,
16 screenshots, iframe isolation, keyboard and touch selection, the exact-value table, retry, empty,
single, zero, missing-only, light/dark, compact desktop, and reduced-motion behavior. The missing
current mark remains a nonselectable tooltip context; Enter selects the aligned known comparison
(`3 entries`, **2026-08-03**). Scoped checks passed; that targeted run is not the current broader
browser acceptance, and all newly authored E2E runtime tests remain unrun. Evidence is in
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/chart-selection-runtime-20261029/result.md`
and the adjacent `complete-vitest.log`.

Earlier attempts had an invalid URL, stale label expectations, and Enter aimed at a missing current
mark. They are historical failures, not current chart blockers.

##### Earlier typed-JSON-path query diagnostics (2026-10-29)

These nine one-execution results matched their baselines exactly; they are diagnostics, not p95s:

| Diagnostic         | One execution (ms) |
| ------------------ | -----------------: |
| Rolling targets    |            418.771 |
| All-time targets   |          1,221.915 |
| All-time exercises |            280.548 |
| All-time equipment |            698.449 |
| Rolling totals     |            173.208 |
| All-time totals    |            580.779 |
| All-time volume    |            299.561 |
| Rolling exercises  |             35.344 |
| Rolling equipment  |             64.765 |

The captures are `fitness-schema-aligned-20261029/diagnostic-typed-path-current-a` and
`fitness-schema-aligned-20261029/diagnostic-typed-path-totals-a`. Host load was not quiet. These
single executions do not establish a p95. The older coordinated warm capture below is historical and
failed; the schema-aligned 20-case warm gate above is the current local gate.

##### Earlier pre-typed-path query diagnostics (2026-10-29)

The pre-typed-path one-execution results also matched the prior baseline exactly. They are retained
for comparison and are not p95 samples:

| Diagnostic      | One execution (ms) |
| --------------- | -----------------: |
| Rolling targets |            457.727 |
| All-time        |          1,521.225 |
| Exercises       |            480.086 |
| Equipment       |            687.381 |

##### Earlier schema-aligned diagnostics (2026-10-29)

A separate clone added only `entity.content_generation integer NOT NULL DEFAULT 1` to match the
canonical schema. The original ten-table fingerprints, indexes, data, and captures were preserved.
The aligned baseline below records one execution per case, with no warm repeats; these are
diagnostics, not accepted p95 results.

| Recipe            | Rolling (ms) | All-time (ms) |
| ----------------- | -----------: | ------------: |
| Totals            |       223.27 |        949.53 |
| Volume trend      |            — |        405.25 |
| Target ranking    |       520.60 |      3,205.39 |
| Exercise ranking  |        43.56 |        436.32 |
| Equipment ranking |        57.20 |      1,475.46 |

At this checkpoint, the `jsonArrayFirst` role-weight fix maps primary/untyped roles to 1,
secondary to 0.5, and stabilizer to 0 inside the aggregate; missing roles coalesce to 1. It restores
stabilizer recency while keeping stabilizers out of weighted-set totals. Scoped source checks
passed; at that checkpoint SQL-home tests and e2e acceptance were pending. A follow-up single-execution
diagnostic measured target ranking at 443.77875 ms rolling and 3,073.075 ms all-time. Its JSON
results exactly matched the aligned baseline for both scopes. It has no p95 samples, and all-time
remains above the 2,000 ms target. The generic bounded-source compiler passed 87 focused tests at a separate
checkpoint.

Each successful sample has one first execution and 20 warm executions; p95 is the 19th sorted warm
sample. First execution is **not** a flushed OS/database-cache measurement. Measurements include
SQL execution and recipe decoding in one local connection; HTTP and iframe rendering are excluded.
Concurrent development work on the host can affect timings.

##### Historical coordinated capture after generic SQL and domain join changes (failed, 2026-10-29)

`coordinated-after-handoff/` contains an earlier authorized serialized run, with 20 warm samples for
every successful case. It is retained as historical failed-gate evidence; the current schema-aligned
gate above supersedes it. Fixture counts, source hashes, indexes and unchanged JIT/timeout settings
are recorded in `metadata.json`. Metadata counts cross the SQL boundary as decimal strings.

| Recipe              |             Rolling first / p95 (ms) |            All-time first / p95 (ms) |
| ------------------- | -----------------------------------: | -----------------------------------: |
| Totals              |                    578.0 / **414.2** |              14,587.1 / **24,943.1** |
| Volume trend        |                          59.6 / 67.1 |                2,628.1 / **3,579.4** |
| Workout trend       |                          17.9 / 22.0 |                          94.9 / 84.1 |
| Workout-start hours |                          20.2 / 26.0 |                          86.9 / 83.9 |
| Measurement trend   |                            2.5 / 1.7 |                         94.0 / 103.2 |
| Target ranking      |  2,579.2 / unavailable: warm timeout |       30,116.7 timeout / unavailable |
| Exercise ranking    | 21,853.2 / unavailable: warm timeout | 18,917.4 / unavailable: warm timeout |
| Equipment ranking   |       30,077.2 timeout / unavailable |       30,048.4 timeout / unavailable |
| Workout drilldown   |                        109.0 / 228.2 |                         67.9 / 122.8 |
| Reading drilldown   |                          24.9 / 14.5 |                           10.0 / 7.9 |

Rolling target and exercise rankings completed six and five warm samples before timeout;
all-time exercise ranking completed twelve. Their partial samples are retained but have no p95.
Confirmed timeout cases were not retried for another 20-sample run. The available decoded outputs
reconcile with `oracle.py coordinated-after-handoff`, including all-time totals and volume.
Rolling equipment and all-time target/equipment results are unavailable because their first
executions timed out. The separate production correctness suite passes duplicate-anchor rejection,
exact user/plugin/kind matches, missing evidence, readiness, filters, cursors, units and gaps.

The new rolling totals set plan has no JIT and executes in 137.2 ms (estimated cost 41,857.9).
Its exact left join replaces the two per-set evidence subplans. This capture identified:

- Ranking fields still compile five sibling aggregate scopes over the same occurrence/set/workout
  joins: weighted sets, raw sets, distinct matched sets for ambiguity detection, workouts and
  occurrences. Selection/order/cursor reuse works, but these distinct measures scan the same
  relations separately. Estimated rolling target cost is 3,038,353.6 with 160 JIT functions;
  all-time target cost is 5,340,221.5 with 201 functions. Timeout plans are estimated, not analyzed.
  A minimal generic compiler follow-up is to fuse measures with identical source, joins and
  predicates into one correlated aggregate relation, retaining the existing expressions and cursor
  contract. Fitness cannot express that shared aggregate scope with the current cursor-row recipe.
- All-time totals retain the distinct-set ambiguity guard. The analyzed set query executes in
  14,590.3 ms, with an external merge sort (14,792 KiB reported by one worker), 276 JIT functions
  and two personal-best-array aggregate subplans each executed 100,000 times. The all-time volume
  plan executes in 2,129.8 ms without JIT. Full-scope scalar/aggregate execution remains costly.

These are measured failures, not accepted performance improvements inferred from the older
shared-host capture. Further optimization must keep duplicate rejection and freshness gates.

##### Narrow integrity diagnostic after generic aggregate fusion

`narrow-integrity-diagnostic/` records one full execution and one analyzed plan per totals recipe,
with no warm sample loop. Shared-host validation was active, so these durations are diagnostic only.
The decoded totals exactly match the previously oracle-checked coordinated capture. This diagnostic
does not replace the current local warm gate above. `plan-summary.json` records widths, sorts, hash
spills and buffers.

| Scope    | Full execution (ms) | Metric plan (ms) | Integrity plan (ms) |
| -------- | ------------------: | ---------------: | ------------------: |
| Rolling  |               293.6 |            152.7 |                93.4 |
| All-time |             1,263.3 |          1,057.7 |               320.0 |

The metric plan no longer sorts 100,000 wide rows. Its only sort is the one-row projection declaration
sort (25 KiB). The all-time integrity sort carries only the set ID (estimated width 14), uses in-memory
quicksort (1,537 KiB reported by one worker), and has no projection reads. Neither totals plan uses JIT.
The prior generic-fused metric plan had estimated sort width 450 and a 47,608 KiB external merge sort.

All-time metric buffers: 9,643 shared hits, zero shared reads, 7,346/7,411 temporary blocks read/written.
Integrity buffers: 7,467 shared hits, zero shared reads, 3,905/3,968 temporary blocks read/written.
Remaining temporary I/O comes from hash joins: the event join hashes still carry JSON properties
(estimated widths 256 for metrics and 244 for integrity; eight batches), and the metric projection
hash uses two batches. No work-memory, JIT, timeout, index or limit settings were changed.

`narrow-integrity-correctness-final/` checks the actual executor SQL and decoded results: exactly five
queries, a projection-free integrity aggregate, no distinct count in the metric aggregate, duplicate
rejection including filtered totals, exact kind/plugin/user matching, missing evidence, readiness, filters,
cursor pages and the independent arithmetic oracle.

Generic fusion now emits one lateral aggregate per ranking root. Its retained diagnostic plans show
the remaining work: rolling targets scan the 10,000-workout date source ten times (100,000 guarded
date evaluations), and evaluate frozen-role lookups per matching set. The all-time exercise plan
performs 20,000 set index probes and exact JSON kind/order comparisons. Owner/schema filters already
reach event scans, and period predicates reach workout scans; moving those inner-join predicates
does not remove the repeated root-independent work. A generic follow-up would need to share the
range-qualified workout relation across correlated ranking roots, or reuse extracted scalar join
keys/role lookups. Replacing the cursor-row recipe with grouped aggregates would lose its empty-row
and cursor contract. No ranking semantics were changed in this diagnostic step.

The next bounded measurement is range-source sharing for rolling rankings. All-time exercise ranking
already shares its workout hash and selects occurrences per root; blanket materialization is not the
proposal. Preserve frozen role weights, empty ranking rows, distinct counts and cursor ordering while
measuring the remaining per-set role lookups and set index probes. No domain API change is required
for this generic SQL work. A new serialized 20-warm-sample capture needs separate authorization after
the ranking plans are plausible; diagnostic timings under host load are not accepted p95 results.

##### Initial shared-host capture

| Rolling 30-day recipe | First run (ms) | Warm p95 (ms) |
| --------------------- | -------------: | ------------: |
| Totals                |        3,003.1 |       3,863.5 |
| Volume trend          |        2,232.3 |       3,055.1 |
| Workout trend         |           14.3 |          15.3 |
| Workout-start hours   |           14.8 |          15.1 |
| Measurement trend     |            2.2 |           2.0 |
| Target ranking        |        2,840.6 |       6,041.0 |
| Exercise ranking      |        1,572.6 |       2,149.2 |
| Equipment ranking     |        4,264.1 |       5,861.3 |
| Workout drilldown     |           88.3 |          60.4 |
| Reading drilldown     |           16.0 |           8.2 |

| All-time recipe     |     First run (ms) | Warm p95 (ms) |
| ------------------- | -----------------: | ------------: |
| Totals              | 30,095.8 (timeout) |   unavailable |
| Volume trend        | 30,111.2 (timeout) |   unavailable |
| Workout trend       |               89.1 |         130.7 |
| Workout-start hours |              368.9 |         873.3 |
| Measurement trend   |              152.2 |         367.9 |
| Target ranking      | 41,182.5 (timeout) |   unavailable |
| Exercise ranking    |           15,457.6 |      15,732.7 |
| Equipment ranking   | 30,165.8 (timeout) |   unavailable |
| Workout drilldown   |               43.0 |          44.8 |
| Reading drilldown   |               54.0 |          24.5 |

This initial capture is complete. Timeout durations are caller-observed elapsed time; the database statement
timeout remains 30 seconds. No warm p95 is claimed for timeouts. The first all-time volume attempt
was interrupted by a warm-run timeout; the retained retry above timed out on its first execution.
Exercise-ranking warm samples ranged from 2,094.8 to 20,010.5 ms. These captures establish a failed
gate under shared-host load, not a controlled before/after comparison.

The ranking recipe needs four distinct facts: raw sets, weighted sets, distinct workouts and
distinct exercise occurrences. Its repeated weighted aggregate in selection/order/cursor SQL is
the generic compiler handoff; domain recipes retain canonical RyotQL expressions and cursor
semantics. No plugin SQL workaround or precomputed rollup is introduced.

The rolling totals set plan emitted 441 JIT functions (1,927.5 ms compilation; 2,675.1 ms total
execution), with two stream index scans each executed 300,000 times. The volume plan emitted 245
functions (1,191.8 ms JIT; 1,773.1 ms execution). Ranking SQL repeats correlated aggregate work for
selection, ordering and cursor data; target ranking emitted 323 functions (1,831.5 ms JIT;
2,914.3 ms execution). These plans identify generic projection-status lookup and aggregate SQL
shape as the next optimization work. Freshness checks cannot be removed to meet the target.

Independent arithmetic over the scale fixture agrees with rolling totals, both measured trends,
hours, all three rankings and measurement buckets. A separate disposable
`order16_fitness_correctness_20261029a` database exercises 1,200 sets through the same production
executor. Assertions pass for all ten trend totals, retained kind/taxonomy, duplicate target names,
weighted/raw/occurrence/workout counts, all filter kinds, cursor pages, DST hours, half-open local
boundaries, fallback set timestamps, zero/missing measurement values, per-metric units, user
isolation, missing taxonomy, pending/failed projections and honest 1,000-group truncation.

Reproduction evidence is retained under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/fitness-gate-20261029/`:
`fixture.sql`, `run.ts`, `correctness.ts`, `oracle.py`, and the `final/`, `drilldowns/`,
`remaining/`, `coordinated-after-handoff/`, and `correctness/` output directories. SQL files retain bound parameters; successful
plans use `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, while timeout plans are estimated only.
The correctness fixture substitutes `generate_series(0,119)` for `generate_series(0,9999)`;
its mutation assertions require a fresh fixture. At this historical query-fixture checkpoint, the
Analytics UI had not started. The scoped query and chart results above do not establish complete UI
acceptance; current implementation status is recorded in the Analytics query API section.

The authorized complete timing command used for the coordinated capture was:

```sh
FITNESS_GATE_OUTPUT=coordinated-after-handoff FITNESS_GATE_REPEATS=20 bun /private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/fitness-gate-20261029/run.ts
```

Use a fresh output directory name for any further authorized capture. The runner records source
SHA-256 hashes, database settings and fixture counts in `metadata.json`, plus individual warm
samples. These metadata additions do not retroactively identify source revisions for older runs;
their captured SQL is retained as the baseline evidence.

### C. Media consumption query gate and retention evidence

Moved from `plugins/media/README.md`.

#### Order 16 query gate evidence

##### Current performance status — owner decision (2026-10-29)

The owner accepted the current canonical seven-query implementation as adequately fast: the latest
normal-period single diagnostic was 946.445084 ms and the all-time single diagnostic was 2,591.592 ms.
These are not p95 results, and no complete 20-warm-sample acceptance run was captured. The owner
waived the former 500 ms / 2,000 ms warm-p95 targets as release blockers for the current
implementation; these numeric targets remain historical benchmark guidance only. Stop further Media
query optimization for this implementation. The shared-scan, projection-prefilter, and four-query
candidates remain unimplemented and not production-approved. This does not approve floating-point
behavior changes, a new SQL shape, framework, dependency, or reduced correctness/readiness.

##### Latest all-time single-execution diagnostic (2026-10-29)

The all-time report completed all seven named queries (`current`, `previous`, `rankings`, `hourly`,
`trends`, `coverage`, and `reviews`) in one execution per query. The first recipe took **2,591.592
ms**; decoded totals matched source expectations. This is one synthetic-fixture diagnostic, not a
p95. The owner accepted this current speed as adequate; no all-time p95 was measured. The
manifest and artifacts are under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/media-all-time-diagnostic-20261029/result-a/`.

##### Rejected projection-stream prefilter diagnostic (2026-10-29)

Do not implement the scoped projection-relation prefilter. Its one raw sample per query regressed
both current-total queries; exact raw equality does not make it a performance improvement:

| Query             | Baseline (ms) | Candidate (ms) | Exact raw equality |
| ----------------- | ------------: | -------------: | ------------------ |
| All-time current  |       637.092 |        668.732 | Yes                |
| All-time coverage |       234.939 |        230.186 | Yes                |
| Month current     |       147.018 |        180.678 | Yes                |

These are single raw executions, not p95s. All raw rows were bit-exact, but the all-time-current
and month-current queries regressed; no production patch was proposed. Full method, limits, and
evidence: `/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/projection-stream-prefilter-20261029/REPORT.md`.

##### Latest durable normal-period report diagnostic (2026-10-29)

The current period report uses seven named queries. The latest synthetic ready-projection fixture has
100,000 observations across 400 titles and 1,000 reviews; it does not prove ordinary writer,
correction, or runtime-publication behavior. One full first-recipe execution took 946.445084 ms,
including durable writes. Each named query ran once, with no warm samples:

| Query    | First execution (ms) |
| -------- | -------------------: |
| Current  |              165.109 |
| Previous |              141.002 |
| Rankings |              139.152 |
| Hourly   |              139.563 |
| Trends   |              149.388 |
| Coverage |              195.089 |
| Reviews  |                3.801 |

The public decoded output matched the earlier `source-date-base-a` capture exactly. That baseline
matched its independent oracle across 29,418 scalar values. This equality is correctness evidence,
not a p95 result. The owner accepted this current speed as adequate; no normal-period p95 was
measured. Earlier 1.228 s and 2.479 s diagnostic timings are historical, not current-path
performance. A four-query candidate was rejected: it took 3,822 ms versus 1,169 ms, including
2,269 ms JIT, and changed fractional reassociation. The repository was not changed by that prototype.

A later remaining-cost analysis summed six period pipelines at 933.104 ms. Even if coverage were free,
738 ms remains; freshness costs less than 1 ms. At that historical checkpoint, no plausible small fix
met the then-active 500 ms target, and no 20-warm-sample p95 acceptance run was complete. The user
approved only a read-only generic shared-scan feasibility prototype, now complete. Its strongest five
period pipelines took 233.851 ms;
unchanged coverage took 377.029 ms and reviews 3.818 ms, for 614.699 ms total SQL. This excludes
runtime, decode, and artifact overhead. It is one uncontrolled-host execution, not a p95 or a
controlled speedup from the loaded 1,704.675 ms baseline.

The prototype materialized only 7,700 candidate rows with native guarded scalars; individual
aggregates, grouping, ordering, and limits stayed unchanged, with no subtotal regrouping. All 82
private assertions passed (30 + 30 semantics, 6 + 6 source order, 10 fallback); retained-month raw
and public results matched exactly. Source hashes for 14 files were unchanged, and defaults, indexes,
data, and captures were preserved. See `media-shared-scan-prototype-20261029/RESULTS.md`.

This does not prove production eligibility for arbitrary floating-point `SUM` transition order. The
combined statement has one 30-second timeout instead of separate 30-second per-named-query timeouts,
and result-byte accounting is unresolved. Production use remains unauthorized; this prototype is
not a production implementation or an acceptance pass. The main implementation will not adopt it
as-is. The former warm-p95 targets are waived as release blockers for the current implementation;
no p95 pass is claimed, and no further Media query optimization is approved.

##### Earlier durable full-report diagnostic (2026-10-29)

This earlier capture used the same synthetic ready fixture. It was one execution only, not a p95 run.
The full first recipe took 2,478.794 ms including durable writes. Its captured per-query times were:

| Query    | First execution (ms) |
| -------- | -------------------: |
| Current  |              530.812 |
| Previous |              445.677 |
| Rankings |              409.318 |
| Hourly   |              395.073 |
| Trends   |              472.418 |
| Coverage |              208.457 |
| Reviews  |                3.261 |

An independent oracle found zero differences across 53 comparison groups, 29,418 scalar values,
and 14,841 numeric values. The capture covered current and previous results for four media types,
384 ranking groups with the first 100 ordered rows (`hasMore: true`), 232 trend rows, four hourly
rows, all four coverage rows, and 58 reviews (43 rated; rating sum 2,900). It did not cover nonzero
missing/pending/failed states, DST, other periods, later ranking pages, or historical-type-only zero
rows. Earlier 16–20 second runs in a three-warm-run loop were interrupted; no p95 was obtained.
These remain historical failed evidence.

The initial direct RyotQL subtotal probe was rejected on 2026-10-28; its temporary recipe and runner
were removed. It used cumulative high-water differences within completion boundaries, with the
reporting filter outside history calculation. It was not a complete canonical report and did not
resolve all changed-denominator, suppression or mixed recorded/estimated allocation cases.

Disposable PostgreSQL 18 database `order16_media_gate` contains one account, 1,000 game titles,
100 observations per title (90 progress and 10 completion rows; 100,000 total), with repeated runs.
The fixture's modulo-day ordering puts each title's last generated completion first and leaves a final
unfinished run. Event indexes match
the relevant existing user/entity/schema/order and JSON indexes; no limits or caches were changed.
The real RyotQL executor generated the SQL. No legacy source database was changed.

| Probe                                             | Result                                                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account-wide minutes subtotal                     | First execution hit the existing 30-second statement timeout; no p95 claimed.                                                                                                   |
| One title, 100 observations, same account dataset | First execution 2,483.85 ms; 20 subsequent executions, warm nearest-rank p95 6,619.00 ms. Local concurrent Order 16 work was running.                                           |
| Bounded response                                  | One aggregate row, 81 bytes; no grouped-result truncation.                                                                                                                      |
| Shape                                             | One named query, one root join, correlated depth 2; document 47,011 bytes, generated SQL 38,933 bytes.                                                                          |
| `EXPLAIN (ANALYZE, BUFFERS)` on the title probe   | Aggregate over nested-loop/index scans; 88,976 shared-hit blocks, zero read blocks; planning 2.31 ms, execution 2,451.634 ms. JIT compiled 182 functions and took 2,371.218 ms. |

This is lower-bound failure evidence, not acceptance of a full report. At that historical checkpoint,
benchmark guidance called for at least 20 warm executions of the complete canonical report: p95 ≤500 ms
for normal periods and ≤2 s for all-time over 100,000 observations/account, with first-execution and
real-dump results separate. The owner later waived those former targets as release blockers for the
current implementation; no p95 pass is claimed.
The raw generated SQL, parameters and full plan are retained in the session temporary artifact
`media-consumption-gate-small.log`; the timeout is in `media-consumption-gate.log`. These direct-query
results do not measure the current bounded projection implementation. Its database correctness,
restore rebuild, and publication acceptance remain separate gates for complete Order 16 acceptance;
they do not describe whether UI implementation has started.

#### Order 16 retention runtime (2026-10-29)

An earlier Media retention runtime was **2/3, not acceptance**. Merge passed, clear/reuse passed, and
restore setup wait timed out after 180,003 ms. There is no accepted restore result; source facts
observed before the stale assertions do not prove restored data. Generic automatic restore repair
admission is now implemented, but full retention and restore acceptance remain open. The
minimal-fixture correction is active; no restore pass or manual retry is claimed. No restore diagnosis
is claimed. Evidence:

- Main run: `/Users/diptesh/.local/share/opencode/shell/69c95d6aa34813057528c971b0d0be7ab227f764/sh_1856a5aae0019qzjhlx6ENsrv3.out`
- Server: `/tmp/ryot-e2e-server-logs-MXbcut/ryot.log`
- PostgreSQL: `/tmp/ryot-e2e-postgres-98717.log`

### D. Media consumption benchmark fixture

Moved from `plugins/media/benchmarks/README.md`.

`consumption.ts` exports a deterministic 100,000-observation source iterator, expected all-time
quantities, and prepared production query cases. It does not write precomputed projections.

`mediaConsumptionLongTitleSources()` supplies a separate 100,000-observation, single-title unfinished
run with fractional recorded pages and multibyte source identity. Load it separately and compare the
scoped `singleLongTitle` report with `mediaConsumptionLongTitleExpected`. The production script host
test serializes and restores every checkpoint, verifies UTF-8 size below 16 KiB, and enforces at most
100 updates per invocation; this is capacity evidence, not a database timing result.

Load the iterator into a disposable user's Media installation with stable entity/event ID mappings.
Preserve `sourceRun`, properties, and event ordering. Create each `(schema, entityId)` once, then
write source events through the ordinary event writer in bounded batches. The fixture includes
more than 1,100 independent runs on a single title, manual-time replacement, fractional time,
repeated episode zero, fractional chapters, volume context, and explicit volume occurrences.
Run ordinary history correction and consumption projection work to readiness before reading totals.

Use `mediaConsumptionBenchmarkCases(owner, mappedLongTitleEntityId)` with the standard plugin-user query executor and
decode each response with its prepared recipe. Compare the all-time totals with
`mediaConsumptionBenchmarkExpected`; exclude no undated observations from all-time totals.
The month/year cases filter repaired contributions, not source events. Date-only evidence must
stay on its recorded calendar date. Record pending/failed counts and reject results that are not ready.

The original benchmark guidance was to record cold timings separately, then run each complete query
case at least 20 times warm, retaining response bytes and query plans. Record p50/p95 and the generic
freshness SQL shape. The normal-period p95 ≤500 ms and all-time p95 ≤2 s targets remain historical
guidance only; on 2026-10-29 the owner waived them as release blockers for the current implementation
and accepted its current speed as adequate. No complete 20-warm-sample p95 was captured, and this is
not a p95 pass. Stop further Media query optimization for the current implementation. Keep normal
query freshness checks enabled. Run edit/delete/move/suppression and restore rebuild checks through
normal writers before accepting the separate database correctness gate.

The report cases execute totals/comparisons, trends, hourly activity, rankings, and reviews together,
using the production recipe and decoder. Record every query's response bytes and `hasMore`; truncated
trend groups are partial data, not a complete chart. Trends retain separate precision rows for each
calendar bucket. The home case exercises its actual scoped query. Include a separate reviewed title
in the disposable fixture by loading `mediaConsumptionBenchmarkReviews()`. Its 1,000 reviews include
missing ratings and known zero; compare with `mediaConsumptionBenchmarkReviewsExpected`. The main
iterator still contains exactly 100,000 consumption observations and its expected quantities exclude
reviews.

Database repair fixtures still required: clear a title and confirm source/occurrence/dependency rows
and totals disappear; merge two titles with independent equal-looking source runs and confirm frozen
basis, fractional quantities, and suppression transfer; export/restore that history and rebuild from
source facts with no cached projections. Confirm both dependency endpoints are rebuilt after moves,
and compare full-report values before/after restore. Source fact retention must survive maintenance
that removes transient correction checkpoints. These are parent-owned E2E/backup harness gates.

#### Incomplete database gate

The owner decision above accepts current query speed but does not turn this incomplete database gate
into a pass. The retained attempt below has no accepted p95; the current speed is supported by the
separate single-execution diagnostics recorded in the Media README. Ordinary-writer publication,
correction, retention, and restore correctness remain separate open gates. A retained earlier
retention runtime attempt was 2/3: merge and clear/reuse passed; restore setup wait timed out. That
historical attempt is not a restore pass. Generic automatic restore-to-plugin repair admission is now
implemented, but backend/domain runtime and restore acceptance remain pending. The minimal-fixture
correction is active; no restore pass or manual retry is claimed. Media Analytics UI work is active,
not complete, and no runtime UI acceptance is claimed.

The retained `order16_media_gate_20261029_0233` fixture contains 100,000 consumption observations and
1,000 reviews for `media-many`, plus a separate 100,000-observation title for `media-long`. Contributions
and ready stream rows were inserted directly. This fixture does not prove ordinary writers, correction,
or database publication. Preserve it and its original output; do not reload it for another attempt.

Only the month report began. Three complete warm samples were 20,526.606, 18,602.312 and 16,297.816 ms
before the coordinator stopped the loop. Its first duration was not durably recorded. There is no
accepted p95, and no other report case or confirmed timeout from that attempt.

Plan-only inspection found each original period-total query estimated cost 636,550, with 36 date-cast
subplans and 185 JIT functions. The production recipe now separates full-history coverage from
period-filtered quantities: its month totals each estimate cost 20,965 with two cast subplans, while
coverage estimates 63,672; none of these plans selects JIT. These are plan estimates, not measured
latency or acceptance. The saved plans identify their compiler/recipe source hashes; concurrent
compiler changes require new plans before timing. No JIT, timeout, memory, index, or limit setting changed.

The retained month response has 232 trend groups and 100 ranking rows with `hasMore: true`. This
historical capture guidance calls for a fresh output directory, immediate persistence of the first
result and every query/sample, an independent scope-specific oracle, and per-section response bytes
and truncation. It does not require another timing run for the current implementation.

An independent arithmetic oracle matched every retained month total, comparison, trend, hourly,
ranking and review value, including section truncation. It found 384 ranking groups before the
100-row limit. The decoded section sizes were 1,810 bytes each for current/previous totals,
105,154 for trends, 1,766 for hourly, 47,765 for rankings, and 131 for reviews. This checks the retained
synthetic-ready response only; the separate current-speed decision does not prove ordinary-writer
publication acceptance.
