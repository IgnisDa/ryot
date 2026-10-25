# Order 16 — Analytics implementation plan

## Status and handoff

This is the approved engineering plan for Order 16 in
[the V1 → V2 gap analysis](v1-v2-port-gap-analysis.md#phase-4--discovery-analytics-and-lower-priority-account-controls).
It is reference material. Maintained user documentation belongs in `apps/docs`.

Planning and code research completed on **2026-10-28**. The owner approved all recommendations
and the five final decision groups recorded below. **Implementation is in progress.** No checks,
performance benchmarks, browser acceptance or real-dump migrations were run during planning.

Implementation started from base commit `7df5abd4dcde2ad88efbf72b416fe97a4db20116`. The initial
modified paths `docs/order-12-entity-reminders-plan.md`, `docs/v1-v2-port-gap-analysis.md` and
`plugins/fitness/client/measurements/screen.test.tsx` are preserved. At the initial handoff, source
facts, query/chart gates, shared hosting/reporting and migration work were delegated and no
acceptance gates were complete. Later scoped results and current open gates are recorded below.

The handoff checkout was at `3665e1ed23563a5af1eecb2a0ec60419251ab9fa`, with concurrent uncommitted
Order 12 notification work, migration changes and documentation changes. Inspect the current working
tree before editing and preserve that work. Paths describe the researched checkout; proposed files
and declarations are identified as such. Recheck nearby code that changed after this research.

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
| Reporting language           | `kernel/backend/src/modules/ryotql/README.md`, `packages/contract/src/modules/ryotql/language.ts`. `dateBucket` supports timezone-aware hour/day/week/month; `timeSeries` aligns in UTC; year and local hour-of-day operations need investigation/extension.                                                                                                      |
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
- Use timezone-aware aggregates for multi-measure charts. Current `timeSeries` is UTC-aligned;
  converting only its labels does not repair its bucket boundaries.
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

## Partial implementation evidence — 2026-10-29

### Latest checkpoint

#### Current status — 2026-10-30

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

Order 16 remains **IN PROGRESS**. Full UI/runtime and consolidated acceptance, broader browser
acceptance, restore/retention, real-dump migrations and restart, cleanup, and final repository
validation remain pending. The owner-accepted current Media speed is not a p95 result and does not
close the separate correctness/readiness gates.
No commits were made.
