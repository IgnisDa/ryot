import { type Compared, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	countUnit,
	type Metric,
	metricDelta,
	MetricGrid,
	QueryStatus,
} from "@ryot-app/plugin-ui-sdk";

import { fitnessMetricDefinitions } from "../../shared/fitness-metrics";
import { analyticsSummaryQuery } from "./queries";
import {
	type AnalyticsDisplayPreferences,
	type AnalyticsScope,
	type AnalyticsTotals,
	metricDisplay,
} from "./reporting-model";

type MetricKey = keyof typeof fitnessMetricDefinitions;

const dayUnit = countUnit("day");

const processingHint = (processing: AnalyticsTotals["processing"]) => {
	if (processing === "ready") {
		return undefined;
	}
	return processing === "failed" ? "Processing failed; may be incomplete" : "Still processing";
};

export function AnalyticsSummary({
	scope,
	compact,
	preferences,
}: {
	readonly compact: boolean;
	readonly scope: AnalyticsScope;
	readonly preferences: AnalyticsDisplayPreferences;
}) {
	const result = useRyotQuery(analyticsSummaryQuery, scope);
	return (
		<QueryStatus query={result} onRetry={result.refetch} label="Fitness analytics summary">
			{(summary) => (
				<SummaryContent summary={summary} compact={compact} preferences={preferences} />
			)}
		</QueryStatus>
	);
}

const coverage = (known: null | number, missing: null | number, noun: string) =>
	(missing ?? 0) > 0
		? { atLeast: true, hint: `${known ?? 0} of ${(known ?? 0) + (missing ?? 0)} workouts ${noun}` }
		: {};

function SummaryContent({
	summary,
	compact,
	preferences,
}: {
	readonly compact: boolean;
	readonly summary: Compared<AnalyticsTotals>;
	readonly preferences: AnalyticsDisplayPreferences;
}) {
	const current = summary.current;
	const previous = summary.previous;
	const processing = processingHint(current.processing);
	const metric = (
		key: MetricKey,
		extra: Pick<Metric, "hint" | "atLeast"> = {},
	): Metric & { readonly unknown: boolean } => {
		const value = current[key];
		const display = metricDisplay(key, value, preferences);
		const old = previous === null ? null : metricDisplay(key, previous[key], preferences).value;
		return {
			...extra,
			key,
			unit: display.unit,
			value: display.value,
			label: fitnessMetricDefinitions[key].label,
			delta: previous === null ? undefined : metricDelta(display.value, old),
			unknown: value === null && extra.hint === undefined && (previous?.[key] ?? null) === null,
		};
	};
	const primary = [
		metric("workouts"),
		metric(
			"activeDuration",
			coverage(current.timedWorkouts, current.missingDurationWorkouts, "timed"),
		),
		metric("volume", { hint: processing }),
		metric("sets"),
	];
	const secondary = [
		{
			unit: dayUnit,
			unknown: false,
			key: "activeDays",
			label: "Active days",
			value: current.activeDays,
			delta: previous === null ? undefined : metricDelta(current.activeDays, previous.activeDays),
		},
		metric("repetitions"),
		metric("distance"),
		metric("personalBests", { hint: processing }),
		metric("personalBestSets", { hint: processing }),
		metric("setDuration"),
		metric("plannedRest"),
		metric(
			"calories",
			coverage(current.calorieWorkouts, current.missingCalorieWorkouts, "with energy"),
		),
		metric("measurementEntries"),
		metric("measurementReadings"),
	].filter((item) => !item.unknown);

	return (
		<section aria-label="Fitness analytics summary" className="flex min-w-0 flex-col gap-3 font-ui">
			<MetricGrid
				variant="tiles"
				compact={compact}
				metrics={primary}
				comparisonLabel="vs previous period"
			/>
			<MetricGrid
				variant="panel"
				compact={compact}
				metrics={secondary}
				comparisonLabel="vs previous"
			/>
		</section>
	);
}
