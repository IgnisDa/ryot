import { usePeriodCaption } from "@ryot-app/plugin-client-sdk/plugin";
import { type Compared, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	type Metric,
	metricDelta,
	MetricGrid,
	QueryStatus,
	ReportText,
} from "@ryot-app/plugin-ui-sdk";

import type { fitnessMetricDefinitions } from "../../shared/fitness-metrics";
import { type FitnessText, useCountUnits, useFitnessMessages } from "../messages";
import { analyticsSummaryQuery } from "./queries";
import {
	type AnalyticsDisplayPreferences,
	type AnalyticsScope,
	type AnalyticsTotals,
	metricDisplay,
	type MetricUnitContext,
} from "./reporting-model";

type MetricKey = keyof typeof fitnessMetricDefinitions;

const processingHint = (text: FitnessText, processing: AnalyticsTotals["processing"]) => {
	if (processing === "ready") {
		return undefined;
	}
	return processing === "failed"
		? text("client.analytics.summary.processing-failed")
		: text("client.analytics.summary.processing-pending");
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
		<QueryStatus query={result} onRetry={result.refetch}>
			{(summary) => (
				<SummaryContent summary={summary} compact={compact} preferences={preferences} />
			)}
		</QueryStatus>
	);
}

const coverage = (
	text: FitnessText,
	known: null | number,
	missing: null | number,
	qualifier: "timed" | "energy",
) =>
	(missing ?? 0) > 0
		? {
				atLeast: true,
				hint: text("client.analytics.summary.coverage", {
					qualifier,
					known: known ?? 0,
					total: (known ?? 0) + (missing ?? 0),
				}),
			}
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
	const text = useFitnessMessages();
	const units = useCountUnits();
	const periodCaption = usePeriodCaption();
	const current = summary.current;
	const previous = summary.previous;
	const processing = processingHint(text, current.processing);
	const context: MetricUnitContext = { text, units };
	const metric = (
		key: MetricKey,
		extra: Pick<Metric, "hint" | "atLeast"> = {},
	): Metric & { readonly unknown: boolean } => {
		const value = current[key];
		const display = metricDisplay(context, key, value, preferences);
		const old =
			previous === null ? null : metricDisplay(context, key, previous[key], preferences).value;
		return {
			...extra,
			key,
			unit: display.unit,
			value: display.value,
			label: text("client.analytics.metric.label", { metric: key }),
			delta: previous === null ? undefined : metricDelta(display.value, old),
			unknown: value === null && extra.hint === undefined && (previous?.[key] ?? null) === null,
		};
	};
	const primary = [
		metric("workouts"),
		metric(
			"activeDuration",
			coverage(text, current.timedWorkouts, current.missingDurationWorkouts, "timed"),
		),
		metric("volume", { hint: processing }),
		metric("sets"),
	];
	const secondary = [
		{
			unknown: false,
			key: "activeDays",
			unit: units("day"),
			value: current.activeDays,
			label: text("client.analytics.summary.active-days"),
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
			coverage(text, current.calorieWorkouts, current.missingCalorieWorkouts, "energy"),
		),
		metric("measurementEntries"),
		metric("measurementReadings"),
	].filter((item) => !item.unknown);

	return (
		<section
			className="flex min-w-0 flex-col gap-3 font-ui"
			aria-label={text("client.analytics.summary.label")}
		>
			<ReportText>
				<p className="text-label text-text-muted">
					{summary.reporting.resolved.previous === null
						? periodCaption(summary.reporting.resolved.current)
						: text("client.analytics.summary.compared", {
								current: periodCaption(summary.reporting.resolved.current),
								previous: periodCaption(summary.reporting.resolved.previous),
							})}
				</p>
			</ReportText>
			<MetricGrid
				variant="tiles"
				compact={compact}
				metrics={primary}
				comparisonLabel={text("client.analytics.summary.comparison-tiles")}
			/>
			<MetricGrid
				variant="panel"
				compact={compact}
				metrics={secondary}
				comparisonLabel={text("client.analytics.summary.comparison-panel")}
			/>
		</section>
	);
}
