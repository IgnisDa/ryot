# Order 16 — Analytics implementation plan

## Status and handoff

This is the approved engineering plan for Order 16 in
[the V1 → V2 gap analysis](v1-v2-port-gap-analysis.md#phase-4--discovery-analytics-and-lower-priority-account-controls).
It is reference material. Maintained user documentation belongs in `apps/docs`.

Planning and code research completed on **2026-10-28**. The owner approved all recommendations
and the five final decision groups recorded below. **Implementation has not started.** No checks,
performance benchmarks, browser acceptance or real-dump migrations were run during planning.

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

| Topic | Approved behavior |
| --- | --- |
| Destination | One global **Analytics** saved view beside Calendar, with plugin-owned Media and Fitness sections. |
| Navigation | Desktop sidebar and mobile drawer, in the global Saved Views section. Canonical URL `/v/k/analytics`; searchable through the command center. Existing sidebar visibility/order controls apply. Home summaries link here. |
| Shared controls | Date range, comparison period, grouping and reporting timezone apply consistently to the contributed sections. Mobile provides section navigation. |
| One metric implementation | Home cards, detail consumption summaries and Analytics share canonical domain metric definitions. Replace conflicting calculations. Current coverage and lifetime consumption remain distinct, clearly labelled measures. |
| Partial consumption | Include reliably recorded progress, including unfinished media. Quantities and manual time mean the cumulative total reached in the current consumption run. |
| Attribution | Attribute each increase to its recorded observation. Do not spread a completion evenly between start and finish dates. |
| Backward progress | A lower new cumulative reading adds no consumption. Correct earlier consumption through Edit. A completed run followed by new progress starts another run. |
| Repeats | Count each consumption occurrence. Report distinct titles separately. Preserve independent explicit records under Order 1; do not heuristically deduplicate them. |
| Episodic media | Report title completions separately from consumed episode occurrences. Do not add parent and child durations for the same consumption. Specials count as consumption even though they do not complete a parent. |
| Historical estimates | Retain the metadata basis used when consumption was recorded. Later provider refreshes must not rewrite past estimates. Distinguish recorded amounts from metadata estimates. |
| Unknown dates | Include in all-time totals and a visible undated count. Exclude from dated charts and comparisons. A placeholder ordering timestamp is not a consumption date. |
| Date precision | Preserve exact instant, calendar-date-only and unknown evidence. Date-only records stay on their recorded calendar date and never become fabricated hourly activity. |
| Unknown quantities | Show the known subtotal and missing-data coverage. Unknown is not zero. Do not silently use current provider metadata to fill a missing historical basis. |
| Imported cumulative progress | When the source supplies no reliable consumption date, treat cumulative progress as an undated baseline. Do not put an entire imported history on its import or last-update day. |
| Synced list state | Exclude list-state snapshots from consumption totals, with a clear explanation. AniList state, repeat counts and partial dates do not establish individual consumption occurrences. Actual imported history counts normally. |
| Reporting timezone | Account-level IANA timezone, initially taken from the device and editable in preferences. Analytics and home reporting use it. Device travel does not silently move reporting boundaries. |
| Fitness units | Keep kg, km, seconds and kcal in storage; convert for display through existing preferences. |
| Workout duration | Use recorded active duration. Keep set duration and planned rest separate, so they are not added again to workout duration. Missing active duration stays unknown. |
| Rest | Label the existing recorded rest targets **Planned rest**. Actual elapsed-rest instrumentation is outside this item. |
| Fitness taxonomy | Freeze recorded workout muscle/equipment assignments so later exercise taxonomy changes do not rewrite historical rankings. |
| Exclusions | Do not add `exclude_from_analytics`. Broader exercise merge is not part of this item. |
| Access | All Order 16 analytics and date ranges are available without Pro gating. |
| Charts | Polished, responsive, interactive charts with useful mobile, light/dark, keyboard and reduced-motion behavior. Start with the existing chart dependency; discuss any new dependency before adding it. |
| Greenfield | Breaking schema and API changes are allowed. No V2 compatibility readers, retained obsolete APIs or parallel calculation paths. Keep repository artifact/protocol/API/compiler version constants unchanged. |

The reporting timezone does not automatically change workout/reminder input-timezone semantics.
Date entry retains explicit source evidence; reporting controls determine how exact instants are
grouped. Hiding a navigation view must not become a permission to discard its historical data.

## 2. Research findings and source map

Read the applicable `AGENTS.md` and feature READMEs before editing. Relevant owners include Media,
kernel backend/client, contract, client SDK/contract/compiler/UI SDK, kernel renderers, migrations,
backups and e2e. Follow root ownership, Effect, testing, validation and cleanup rules.

| Concern | Existing source and implication |
| --- | --- |
| V1 metric inventory | `crates/models/dependent/src/analytics.rs`, `crates/services/statistics/src/{analytics_operations,daily_activity_operations}.rs`, `crates/utils/dependent/analytics/src/lib.rs`. Use as capability evidence, not a prescription for a daily summary table. |
| V1 UI/access | `crates/frontend/app/routes/_dashboard.analytics.tsx` restricts some date ranges to Pro and supports image capture. The new feature has no Pro restriction; image export was not approved as part of this scope. |
| Global navigation | `kernel/client/src/modules/shell/sidebar-sections.ts` places kernel views in the shared Saved Views section. Desktop and mobile share navigation data. |
| Kernel views | `kernel/backend/src/modules/definitions/kernel-source.ts` declares All Collections and Calendar; Analytics should follow this definition-owned pattern. |
| Page composition | `kernel/backend/src/modules/pages/preparation/README.md`, its `{graph,composition,document,service}.ts` modules, and `packages/contract/src/modules/pages/schemas.ts`. Existing composition owns contributor identity, dependencies, artifact grants and freshness. |
| Client declaration/bootstrap | `packages/contract/src/modules/plugins/manifest.ts`, `packages/plugin-client-sdk/src/bootstrap/composition.ts`, `packages/plugin-client-contract/src/navigation.ts`. There is no analytics-section registration yet. |
| Renderer ownership | `packages/kernel-renderers/{README.md,src/index.ts}`. Renderers are compiled plugin sources, not kernel-DOM pages. Regenerate sources; do not edit generated text. |
| Media home | `plugins/media/shared/activity-recipes.ts` currently aggregates event rows and uses `timeSpent` then `runtime`; it misses type-specific fallbacks used by title recipes. Unknown completions still enter period totals through `occurredAt`. |
| Media measures | `plugins/media/shared/media-recipes.ts`, especially `mediaTimeSpentMeasure`, `mediaEntityCountMeasure`, `mediaFlatConsumptionTotals`; per-type recipe files configure runtime, music `duration / 60`, visual novel `lengthMinutes`, pages, episodes or chapters. |
| Episodic coverage | `plugins/media/shared/episodic-recipes.ts`, `episodicScopedCoverageSelection`, measures current coverage. It is not lifetime rewatch consumption. |
| Lifecycle | `plugins/media/shared/lifecycle-expressions.ts` supplies effective order, parent/episode ownership and cycle expressions. Use logical `(occurredAt, orderCreatedAt, orderKey)` ordering. |
| Logging contracts | `plugins/media/shared/{media-activity-operations,media-activity-fields}.ts`, `manifest/schemas/entity.ts`. Progress currently lacks date/manual-time input and has per-kind property rules. |
| Lossy logger | `plugins/media/client/media/activity-log/state.ts` converts entered pages to rounded percent. Selected past days become local noon; today becomes submission time. Preserve the actual quantity and precision instead. |
| Runtime writes | `plugins/media/backend/operations/{media-activity-log,media-activity-update,media-activity-delete}.sandbox.ts`, `media-activity-edits.ts`; imports/integrations converge through `backend/imports/{write-chunks.sandbox,schemas,integration-progress}.ts` where applicable. |
| Write policies | `kernel/backend/src/modules/events/event-creation.ts` captures entity reference properties and checks them before persistence. Media can use one before-policy to validate/capture consumption facts across ordinary runtime writers. Read automations and user-command protocols first. |
| Correction evidence | `plugins/media/shared/history-correction.ts`, `manifest/schemas/history-correction.ts`, `backend/automations/{history-correction,reconcile-media-history.sandbox,media-history-correction.sandbox}.ts`, `backend/contracts/history-correction-recipes.ts`. Frozen evidence already preserves positional totals and episode inventories for automatic completions. |
| Exact output matching | `occurrenceProperties`, `occurrenceMatches` and `propertiesMatch` in the correction worker compare automatic output with expected properties. New snapshot fields must not accidentally turn an automatic completion into an explicit override or cause a repair loop. |
| Clear/merge | `plugins/media/manifest/user-state.ts` declares child/evidence scope and reset-on-merge behavior. New references must participate in remapping, stale checks, clear and retention. |
| AniList distinction | `plugins/media/shared/list-state.ts`, `backend/integrations/yanks/anilist{,.sandbox}.ts` preserve state snapshots. `backend/imports/anilist.ts` has a separate actual import path; classify each source fact rather than exclude all AniList data. |
| Fitness totals | `plugins/fitness/shared/workout-list-recipes.ts` already supplies period totals, comparisons, date buckets and set counts. Extend its canonical expressions. |
| Fitness records | `plugins/fitness/shared/workout-records.ts`, `backend/workout-record-step.sandbox.ts`, `backend/automations/{workout-records,workout-set-policy}.sandbox.ts`. Preserve kind-aware volume and record rules and existing freshness behavior. |
| Planned rest | `plugins/fitness/shared/workout-editor-transformations.ts` resolves `restTime` from explicit choice, exercise override and defaults. `restTimerStartedAt` alone is not actual rest duration. |
| Fitness taxonomy | `plugins/fitness/shared/{home-recipes,taxonomy-recipes}.ts` currently reads live target/equipment links. Recording must capture historical assignments for analytics. |
| Measurements | `plugins/fitness/shared/measurement-recipes.ts` and `client/measurements/`. One entry may contain several readings. Current series distinguish missing buckets using counts; retain that behavior. |
| Projection scope | `kernel/backend/src/modules/events/README.md`, its `{stream-work,stream-repository,projection-repository}.ts` modules, and `packages/contract/src/modules/events/stream-work.ts`. A stream currently targets one entity and one event schema; output publication enforces that scope. |
| Reporting language | `kernel/backend/src/modules/ryotql/README.md`, `packages/contract/src/modules/ryotql/language.ts`. `dateBucket` supports timezone-aware hour/day/week/month; `timeSeries` aligns in UTC; year and local hour-of-day operations need investigation/extension. |
| Preferences | `packages/contract/src/schema/user-preferences.ts` currently has language and integration-disable preferences, but no reporting timezone. Use the existing validated account preference write owner. |
| Shared charts | `packages/plugin-ui-sdk/src/charts.tsx` supplies heatmap, ranked bars, sparkline and measurement-oriented time series. `TimeSeriesChart` uses a separate comparison axis and device-local date formatting; analytics needs same-unit period comparison and explicit reporting timezone. |
| Duplicated heatmap | `plugins/fitness/client/workouts/summary.tsx` contains a separate heatmap. Consolidate equivalent rendering through the shared chart primitives while preserving the metric selected by each view. |
| V1 conversion | `apps/server/src/migrations/README.md` and its `{seen-mapping,seen-completion-mapping}.ts` modules. Seen conversion invents intermediate percentages from update timestamps and omits manual time on progress. New analytics must not mistake these for measured consumption. |

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

Measure generated query shape, plans, latency and result size using the available dumps and synthetic
large histories. Report timings and fixture sizes. Agree a concrete performance target at this gate;
the plan does not claim that direct queries already meet it.

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

| Step | Work | Exit gate |
| --- | --- | --- |
| 1 | Recheck current tree; encode approved metric/date/quantity contracts and examples. Inventory all writers/consumers and legacy mappings. | No undefined metric meaning; source/evidence ownership is explicit. |
| 2 | Canonical Media facts, logger/update controls, snapshot policy and correction integration; Fitness taxonomy capture; reporting timezone preference. | Manual/API/import/integration paths produce consistent facts; retries and unrelated edits preserve snapshots. |
| 3 | Direct-query correctness and scale prototype; decide whether existing projections need extension. Build representative chart prototype. | Measured read/repair approach selected; chart interaction/layout validated; unused prototype removed. |
| 4 | Analytics contribution contract, global saved view, composition/SDK/renderer integration. | Generic fixture contribution, ownership, freshness and independent failure behavior pass. |
| 5 | First usable slice: Media consumption totals and Fitness/workout/measurement totals. Migrate equivalent existing calculations. | Analytics, home and detail totals agree for equivalent scope. |
| 6 | Period comparisons, grouping, trends and measurement views. | Timezone/DST/date precision and missing-data behavior pass. |
| 7 | Hourly charts, frequency rankings and paged drill-down; visual refinement. | Complete responsive screen with accessible interaction and no silent truncation. |
| 8 | Complete V1 conversion and backup/merge/removal/retention acceptance. Prepare migration changes alongside earlier schema work, not as a late discovery. | Both real dumps and restart pass; retained facts survive provider refresh and restore. |
| 9 | Affected checks/tests, review fixes, required cleanup, final repository validation and documentation. | Results recorded; only then mark Order 16 Done. |

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
analysis. Order 16 remains Pending/In progress until the complete usable screen and these gates pass.
