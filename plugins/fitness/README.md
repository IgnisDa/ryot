# Fitness Plugin

`shared/plugin-identity.ts` declares `ryot/fitness`. Generic authoring rules belong to the
[Plugin Kit](../../packages/plugin-kit/README.md). Domain recipes and operation schemas live in
`shared/` so client and sandbox code use the same contracts through neutral imports.

Workout details load metadata plus cursor-paged exercises, sets, and previous-session sets; totals
use the complete loaded set collection. Exercise details combine targets/equipment, kind-aware
history, personal bests, recent sessions, instructions, private reviews, and read-only workout/set
notes. Attachments use managed URLs with renewal, image preview, and video playback.

## Exercises And Writes

Custom exercises use the shared entity editor. The manifest declares editors for `exercise` (with
`exercise-targets` and `exercise-uses-equipment`), `exercise-target`, and `exercise-equipment`; the
kernel editor save permits only those declared relationships and atomically saves the entity and
its outgoing links. `kind` is required and immutable. The creation hook adds library membership. Duplication copies visible properties and taxonomy links into a new custom
exercise. Standard and private taxonomies are visible through normal RyotQL scoping; target roles
are optional. Adding a target or equipment opens the kernel entity picker for that schema: visible
taxonomies, Fitness Catalog results not yet imported (importing one selects it), and inline creation
of a private target or equipment through its editor, where a target's `kind` is required.

Provider exercises are read-only in ordinary user editors, including private-provider exercises.
Provider refreshes own their canonical name and properties, including the source-derived `kind`.
Existing workout sets retain their recorded `exerciseKind`; a provider correction does not rewrite
historical set meaning or measurements.

### Recorded taxonomy and canonical metrics

Each performed exercise occurrence has one `workout-exercise` event owned by its exercise,
with `sessionEntityId` pointing to the workout. Sets join it by session, exercise and
`exerciseOrder`. Templates do not produce these events. The editor commits occurrence evidence
with sets, preserves it across historical edits/reorder and removes it when the occurrence is
removed. Strong/Hevy import intents include occurrence events too.

The strict properties are:

```ts
{
  exerciseOrder: number; // nonnegative integer
  exerciseKind: ExerciseKind;
  provenance: "recorded" | "legacy";
  targets: { entityId: string; role: "primary" | "secondary" | "stabilizer" | null }[];
  equipment: string[];
}
```

Each array has at most 100 items. `policy.workout-exercise` captures applicable effective
taxonomy links on creation and rejects overflow rather than truncating. Updates retain the frozen
assignments. All target/equipment IDs are declared `entity-id` references, so ordinary backup
dependency discovery, restore remapping, user-data rewriting and provider retention see them.
The event owner participates in exercise merge; the session reference participates in workout
deletion. There is no per-set copy of the taxonomy.

V1 conversion writes this schema directly, once per performed exercise position, with
`provenance: "legacy"`. Legacy assignments describe the exercise at export time, not proven
assignments at workout time. Runtime capture uses `"recorded"`, including capture during imports.
Use workout start for the occurrence's ordering timestamp; this is not timed-set evidence.

`fitness-metrics.ts`, `workout-list-recipes.ts` and `analytics-recipes.ts` define shared metrics.
Analytics totals expose active-duration and energy coverage, entries separately from readings,
and personal-best awards separately from awarded sets. Missing active duration remains null;
planned rest and set duration are separate quantities. Weight volume uses the existing kind-aware
projection in kg × repetitions. Pending/failed projections hide award and volume totals.
Historical rankings and performed-work muscle displays read retained occurrence evidence, never
current exercise links. Target weights are primary/untyped 1, secondary 0.5 and stabilizer 0.
Rankings expose sets, exercise occurrences and distinct workouts separately and use cursor-paged
root rows. Period attribution uses workout start; all-time totals omit range bounds. Coverage
reports sets without occurrence evidence and sets whose taxonomy came from a legacy export.

Analytics recipe inputs are `{ reference, selection, now, timeZone }`; historical rankings add
`kind` (`targets`, `equipment`, or `exercises`) and optional `after`. Reporting boundaries resolve
from the supplied clock and the account reporting timezone at query execution. Home, workout
summaries, and measurement ranges use the same resolver. Muscle totals key by entity ID, so
equally named targets remain separate.

### Analytics query API

`shared/analytics-recipes.ts` exports the production recipes below. Each accepts the stable
`ReportingSelection`, reporting `timeZone`, plugin `reference`, and execution-time `now`.
`client/analytics/queries.ts` resolves `schedule.now()` inside each query execution, so moving
timestamps do not become query cache keys. Its inputs retain `reference`; a section passes its
explicit `owner` as that reference, so ownership is part of the cache key.

| Recipe                             | Additional input                                                        | Result                                                                               | Named queries |
| ---------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------- |
| `fitnessAnalyticsTotalsRecipe`     | optional `filter`                                                       | Counts, entered measurements, derived metrics, missing-data and taxonomy coverage    | 5             |
| `fitnessAnalyticsTrendRecipe`      | `metric`, optional `period: "current" \| "previous"`, optional `filter` | Sparse buckets with unit, observations, known values, projection coverage, `hasMore` | 1             |
| `fitnessWorkoutStartsByHourRecipe` | optional `filter`                                                       | 24 reporting-timezone bins labeled **Workout starts**                                | 1             |
| `historicalFitnessRankingRecipe`   | `kind`, optional `filter`, `after`                                      | 100-row cursor page of retained-taxonomy counts and weighted sets                    | 1             |
| `fitnessAnalyticsWorkoutsRecipe`   | optional `filter`, `after`                                              | 100-row cursor page, newest workout start first                                      | 1             |
| `fitnessMeasurementTrendRecipe`    | `metricId`, optional `period`                                           | Sparse average buckets with reading count, metric unit and `hasMore`                 | 1             |
| `fitnessMeasurementReadingsRecipe` | `metricId`, optional `after`                                            | 100-row cursor page of readings, unit, occurrence time and entry ID                  | 1             |

`filter` is `{ kind: "exercises" | "targets" | "equipment", id }`. It filters sets and their
workouts; measurement counts in the totals remain independent of workout filters. Trend metrics
are workouts, sets, volume, repetitions, distance, active duration, recorded calories, set duration,
planned rest and personal-best awards. Units come from `fitnessMetricDefinitions`.

Workout trends and hours use workout starts even when imported set timestamps are fallback values.
Measurement trends use reading times and keep metrics separate. Missing buckets remain absent;
recorded zero remains zero. A missing previous period returns no points. Grouped trends have a
1,000-group limit and propagate `hasMore`; consumers must show truncation or select coarser buckets.
Automatic all-time grouping uses years. Paged results retain the kernel cursor and `hasMore`.

Totals, workout cards and exercise aggregates read projection coverage with their values. Pending
or failed coverage hides volume and personal-best results without hiding entered measurements.
The separate processing poll supplies status text, but cannot make an incomplete aggregate ready.
Totals use an exact occurrence left join by user, plugin, session, exercise, order and recorded kind.
The metric aggregate counts joined rows. A separate count-only `evidenceIntegrity` aggregate uses
the same source, joins and filters, without projection reads. Its joined-row count must equal both
its distinct-set count and the metric set count before decoding totals. Both run in the existing
document's repeatable-read snapshot; the left join retains sets with missing evidence, and duplicate
matches fail instead of inflating metrics. Summary comparisons remain separate five-query documents.
Rankings also
reject duplicate matched sets and reuse their joined occurrence for taxonomy filters.

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

### Local SQL-plus-decode query gate (2026-10-29)

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

#### Reporting-charts iframe suite (2026-10-29)

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

#### Earlier typed-JSON-path query diagnostics (2026-10-29)

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

#### Earlier pre-typed-path query diagnostics (2026-10-29)

The pre-typed-path one-execution results also matched the prior baseline exactly. They are retained
for comparison and are not p95 samples:

| Diagnostic      | One execution (ms) |
| --------------- | -----------------: |
| Rolling targets |            457.727 |
| All-time        |          1,521.225 |
| Exercises       |            480.086 |
| Equipment       |            687.381 |

#### Earlier schema-aligned diagnostics (2026-10-29)

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

#### Historical coordinated capture after generic SQL and domain join changes (failed, 2026-10-29)

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

#### Narrow integrity diagnostic after generic aggregate fusion

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

#### Initial shared-host capture

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

The editor fences evidence reads with the workout event-scope revision and rejects duplicate
occurrence positions or evidence that disagrees with the original set owner/kind. The manifest's
session-scoped `eventGroup` keys anchors by `exerciseOrder`; sets must match the anchor's exercise,
order and recorded kind. The kernel now validates final state in the commit transaction, including
unique positions, nonempty anchors, immutable session/taxonomy/kind/provenance and retained set-to-anchor
identity. Atomic editor commands can swap positions, replace exercises and remove the last set with
its anchor. Imports use the existing generic atomic event adapter and omit empty occurrences.
Standalone set writes require a matching anchor; adding a new occurrence or deleting its last set
requires an atomic command that includes the anchor. Before policies capture facts but do not enforce
cross-command cardinality. See [atomic event groups](../../kernel/backend/src/modules/events/README.md#atomic-event-groups).
Focused kernel tests pass at the reported split-run checkpoint; consolidated validation and real
Fitness API/e2e write-lifecycle acceptance remain pending.

`exercise-merge` requires distinct same-kind entities and a custom source. It detaches source
membership/taxonomy links, moves events/notes/collection membership through `mergeUserEntityData`,
then replaces template references. These steps are not atomic: retry-to-complete works after partial
detachment. The client blocks merging an exercise used by the active workout/template draft.

Exercise note operations require a visible exercise and a `review` event on that schema, not merely
the shared review slug. Updates patch only text/rating. Input text is trimmed/bounded, while stored
text remains unbounded for migrated notes. `workout-delete` removes the workout, events, and
relationships, queues surviving exercise record recalculation, and leaves exercises/templates and
separately logged measurements intact. `workout-template-delete` removes the template and its
relationships, leaving workouts started from it intact. Collection additions preserve existing
membership properties.

Mutating inputs carry the stable `SubmissionEnvelope` identity and timestamp. Writers send editable
set properties only; projection processors own derived statistics and personal-best badges. Retried writes keep
their complete input, timestamp, and identity unchanged.

## Storage Units

Set measurements use kg, km, and seconds; workout energy uses kcal. kJ display multiplies by 4.184.
Display preferences never change stored units.

## Workout Preferences And Duration

Preferences belong to the exact user's Fitness installation, not kernel preferences or plugin
configuration. `userSettingsSchema` defines units, per-set-type rest defaults, sound/prompt/countdown
choices, and optional `weeklyWorkoutGoal`. Missing or null goal means unset. Other explicit null
choices are invalid; reset removes stored choices and restores schema defaults.

Optional exercise rest/duration overrides belong to the user's `in-fitness-library` relationship,
never a shared provider exercise. Missing/null overrides inherit; membership-only writes preserve
them. Rest precedence is explicit set/template choice, exercise override, then installation setting
and schema default. Zero disables rest. Duration display uses occurrence choice, exercise override,
then minutes; weight/distance/energy use occurrence choice, then installation/default units. Local
sound/prompt/countdown choices override installation defaults without changing saved values.

`activeDuration` is nonnegative whole seconds including ordinary rest but excluding explicit pauses.
Missing/null means unknown, not zero; timestamp elapsed duration is separate. New sessions sum
unpaused intervals and truncate once. Historical edits preserve recorded duration unless explicitly
corrected/cleared; repeats/templates do not copy it. Running timers, pauses, unconfirmed sets, and
collapse state remain draft-local. Session flow uses timestamps, not configured rest as elapsed rest.

## Measurements

Each user-owned `measurement-metric` has a name, stable key, and optional unit. Its
`measurement-reading` events carry value and occurrence time for analytics. Each submission or
import row creates a user-owned `measurement-entry` containing time and optional comment; its
readings reference it through `sessionEntityId`.
All Measurements uses only page-context name/icon and these
shared recipes:

| Recipe                           | Purpose                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `measurementSummaryRecipe`       | Cursor-paged metrics with latest value/time, first reading, range count, and pin time                                                 |
| `measurementSeriesRecipe`        | Timezone-aware grouped averages; absent buckets remain missing and recorded zero remains zero; metric batches respect the query limit |
| `measurementEntryListRecipe`     | Newest-first entry pages, with all child pages loaded before display and month grouping                                               |
| `measurementEntryReadingsRecipe` | Cursor-paged children of one entry, without a total-child limit                                                                       |
| `measurementPageReadingsRecipe`  | Cursor-paged children of every entry on a loaded page, loaded in one query                                                            |

Ranges through 1Y use daily buckets; All uses weekly buckets, coarsening to months or years for
long histories without dropping early readings. Buckets use the reporting timezone. Trend lines smooth bucket
averages. Loaded rows remain during pagination; malformed/repeated cursors fail rather than loop.
Pinned metrics define tiles and log columns, ordered by pin time. Pins are
`measurement-metric-pinned` relationships to the Fitness Library. Pin requests matching current state
are no-ops; the limit of three is checked before writing, not enforced atomically across concurrent
requests. Metric creation pins while the caller has fewer than two metrics; imports do not pin.

`MeasurementComposer` is shared by the page and live workout editor. It accepts one timestamp,
per-metric finite values (zero included), and an optional comment. Empty values are skipped; at least
one is required. An unchanged timestamp retains seconds. Forms retain input on validation failure
or a refused submission and close once the kernel accepts the write. Live readings save independently and survive workout discard;
historical/template editors do not offer logging.

Measurement and workout-time forms use the device's named timezone. Nonexistent local times are
rejected. Repeated times show both UTC offsets; edits within the original local date preserve its
offset when valid, while other ambiguous times require an occurrence choice. An explicit choice
overrides the original offset.

`measurement-reading-log` validates every metric's schema/visibility, creates an entry, and sends one
`createEvents` batch (at most 100 values). The log, edit, and delete forms hand their write to the
kernel's background submissions and close once it is accepted; the shell tray reports the outcome and
offers Retry, which replays the same input and idempotency key so mutation receipts replay the entry
and committed readings without duplication. A partial write reports `incomplete`. Cancelling never
rolls back committed readings. Exercise note create, edit, and delete use background submissions too.
Workout deletion stays a foreground write because the page navigates away only after it succeeds, and
workout time correction stays foreground because its conflict and invalid results must reach the
form.

Update/delete resolve the caller-owned entry by ID. Update loads all
children, validates event and metric schemas/visibility, patches kept readings, creates added values,
deletes cleared values, then updates entry time/comment. Event writes use batches of at most 100,
including imported entries larger than 100 values. These are separate calls: partial failure may
leave an edit partly applied. Deleting the entry cascades to all session children, including children
the client has never loaded.

Metric creation uses shared normalization and canonical units for known keys; empty normalized names
and incompatible units fail. Unknown keys may have custom units. Client duplicate detection is not an
atomic server uniqueness constraint. Import reuse requires both normalized name and key.

## All Workouts

The `workouts` page uses page-context name/icon, URL-backed layout/search, and shared
`workout-list-recipes.ts` recipes:

- `workoutCardsRecipe` pages newest workouts with server aggregate counts/volume and bounded sets for
  best-set previews. Comparison origin is the repeated workout or latest earlier use of the template.
- Comparison/target recipes batch data for loaded workouts; muscle totals exclude stabilizers.
- `workoutWeeksRecipe` aggregates the loaded span with the same search and filter, preserving
  complete week totals across split pages. The cards, count, and weeks recipes take an optional
  compiled filter predicate; the summary recipe ignores search and filters.
- `workoutSummaryRecipe` compares selected rolling periods and supplies personal bests and daily
  consistency totals. `workoutCountRecipe` counts all matches on demand.

Cards, rows, and tables share the same model and entity presentations. They prefer recorded active
duration, otherwise explicitly labeled elapsed duration, and apply display units. No origin means no
comparison.

Filters (started, exercise count, exercises, sets, personal records, template, collections) use the
SDK filter UI and URL state. `client/workouts/filters.ts` declares the fields and compiles the filter
on the client, because plugin `shared/` code may only import plugin-kit and cannot reach the filter
compiler. The Exercises field is a `session-event` field over `workout-set` events on `exercise`
entities.

### Calendar Source

`manifest/calendar-sources.ts` contributes the kernel Calendar source `workouts`: the user's workouts
(not templates) at their `startedAt` instant, captioned with the distinct exercise count from
`workoutTotals`. It has no art or done mark.

## Home

`fitness-home` serves `/`. Without workouts it shows setup progress for goal, workout, template, and
measurement plus import sources. Otherwise independently loaded/retryable panels show:

- A resume-only banner for a device draft; discard remains an explicit editor action.
- Weekly goal/progress and streaks; goal links open the exact plugin's preferences.
- Latest workout with repeat/template actions, pinned measurements, and the shared logging dialog.
- Templates ordered never-used first, then least recently used, with exercise-target chips.
- Muscle activity over seven days: primary targets count 1, secondary ½, legacy untyped links 1,
  stabilizers excluded. Last-session age considers all roles; never-trained targets remain visible.
- The five newest personal-best sets and count over the last 30 days.

## Imports

Imports append history; separate runs may duplicate earlier activity. Generic reporting, replay,
and cancellation contracts belong to [imports](../../kernel/backend/src/modules/imports/README.md).

- Strong supplies source duration as active duration, truncated once, with end time derived from it.
  Excluding pauses is a source assumption, not verified evidence.
- Hevy preserves start/end and leaves active duration unknown: the export has no duration/pause
  evidence.
- OpenScale turns each dated row into one measurement write item. Numeric columns reuse/create
  metrics by normalized label/key and create readings at the row time with its comment. Known keys
  use canonical units; shared property builders also serve interactive writes. A valid date with no
  numeric value is unsuccessful. Row counts are measurements, not individual reading counts. The
  admitted export timezone interprets local timestamps; explicit UTC offsets preserve their instant.
  Nonexistent daylight-saving times fail per row; repeated local times use the earlier occurrence,
  matching the workout importers.

## Workout Editor Contracts

`workout-editor-context` returns defaulted installation settings and trusted Pro availability.
`exercise-override-update` changes only the caller's membership fields; setting a field to null
restores inheritance, while omitted fields stay unchanged.

`workout-editor-save` creates/updates workouts and templates. Baselines and source exercise positions
preserve occurrence/event identity across reorder. Draft encoding and baseline decoding bound
decompression to 128 KiB; encoded drafts and uncompressed complete save inputs have separate 64 KiB
budgets. The draft's retained submission freezes data, baseline, ID, and timestamp, including across
settings changes. The save command commits the entity, sets, relationships, and any new-workout
completion event atomically; asset uploads are separate.

Templates store plans without execution events. Results distinguish completion, conflicts, validation,
and Pro gates. A known business rejection from the atomic command unlocks edits; uncertain transport
results retain the immutable retry.

Historical edits preserve timestamps. `workout-time-correction` separately changes start/end and
only sets/clears active duration explicitly, retaining unchanged precision. Free historical edits
preserve protected notes/media and may remove them; adding/changing requires Pro. Template changes
and replacement remain Pro-gated.

Complete source recipes page sets and load selected exercises, membership overrides, and source links.
Unavailable exercises or malformed records block hydration without discarding the baseline. Picker,
taxonomy, and Previous/history reads are not Pro permissions.

One controller per client runtime owns immediate input, ordered device persistence, and active-screen
wake demand. Live progression/rest recovery is draft-owned; historical/template modes start no
execution clocks. Finish reviews included/omitted sets before freezing input. Entry routes check
device recovery first: an existing draft requires Resume or explicit Discard, even when Pro creation
is unavailable. Successful entry replaces the action route with `/workout-editor`; successful save
clears the draft before navigating to the saved entity.

Personal media belongs to the workout or exercise occurrence, never the set. Permanent locators stay
in `exerciseMedia` by exercise order, or in template exercise entries. Drafts track newly uploaded
assets for best-effort abandonment cleanup, never delete loaded attachments on cancel, and retain
pending submission media unchanged. Navigation waits for uploads and persistence. Store locators,
not signed preview URLs.

The Fitness Library picker owns selection, filters, sorting, and device-local presets. Provider
search returns IDs that Fitness reloads and checks for eligibility. Create custom closes the picker
and opens the named exercise editor. Cancelling either picker or workout does not remove already
added library exercises.

### iOS Live Workout Activity

The live editor uses the draft ID as activity key and publishes persisted projections through a
coalescing ordered queue independent of draft persistence/save. It does not start activities for
drafts at least eight hours old, ended/submitted drafts, or ended/dismissed keys. Cards show progress,
timers, and optional next-set targets, not notes, media, or separate measurements. Saving ends with
frozen final duration/count/volume for 30 seconds; discard ends immediately. Host/platform behavior
belongs to the [kernel client](../../kernel/client/README.md#ios-live-activities).

## Automations

- Required user-scoped exercise creation/provider-import hooks upsert Fitness Library membership;
  workout imports include the same link. All Exercises lists members only.
- `fitness.workout-created` handles API-created completion events, excluding import causation, and
  emits `workout.created` from immutable event evidence. The notification formatter reads inline
  signal data, has one attempt, and never retries uncertain external delivery automatically.
- `policy.workout-set` validates a batch against captured exercise/workout references, requires a
  valid workout `startedAt`, and uses `confirmedAt` for occurrence time when present. Otherwise it
  preserves the supplied event time. It preserves recorded exercise kind or fills it from the exercise.
  Writers use workout start for new untimed historical sets. Source schemas reject computed fields.
- `fitness.workout-records` batches changed sets by exercise and requests event-projection work for
  each affected exercise. The common background-work owner dispatches bounded steps; the event stream
  retains its checkpoint, dirty boundary, and freshness state separately from the canonical job status.
  Workers compute statistics/badges per recorded kind into separate projection rows without changing
  source events or replaying historical hooks. Workout start changes trigger
  `fitness.workout-context-records` repairs. Calculated displays remain hidden unless the projection
  matches the current source revision and plugin revision/configuration/installation binding; pending or
  failed status is shown and pending queries refresh until processing finishes.
