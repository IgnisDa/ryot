# Consumption production gate

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

## Incomplete database gate

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
