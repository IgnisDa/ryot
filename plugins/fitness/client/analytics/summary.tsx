import {
	comparisonDetail,
	formatExactValue,
	type ResolvedReportingSelection,
} from "@ryot-app/plugin-client-sdk/plugin";
import { type Compared, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { QueryStatus, StatStrip } from "@ryot-app/plugin-ui-sdk";

import { fitnessMetricDefinitions } from "../../shared/fitness-metrics";
import { analyticsSummaryQuery } from "./queries";
import {
	type AnalyticsDisplayPreferences,
	type AnalyticsScope,
	type AnalyticsTotals,
	metricDisplay,
} from "./reporting-model";

type MetricKey = keyof typeof fitnessMetricDefinitions;

const metricValue = (
	metric: MetricKey,
	value: null | number,
	preferences: AnalyticsDisplayPreferences,
) => {
	const display = metricDisplay(metric, value, preferences);
	return { ...display, formatted: formatExactValue(display.value, display.unit) };
};

const metricChange = (
	metric: MetricKey,
	current: null | number,
	previous: null | number,
	resolved: ResolvedReportingSelection,
	preferences: AnalyticsDisplayPreferences,
) => {
	const display = metricDisplay(metric, current, preferences);
	return comparisonDetail({
		resolved,
		unit: display.unit,
		current: display.value,
		previous: metricDisplay(metric, previous, preferences).value,
	});
};

const coverageDetail = (processing: AnalyticsTotals["processing"]) => {
	if (processing === "ready") {
		return null;
	}
	return processing === "failed"
		? "Derived values unavailable · processing failed"
		: "Derived values unavailable · still processing";
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

function SecondaryMetric(props: {
	readonly label: string;
	readonly value: string;
	readonly detail: string;
	readonly extraDetail?: string;
}) {
	return (
		<dl className="flex min-w-0 flex-col gap-1">
			<dt className="text-label text-text-muted">{props.label}</dt>
			<dd className="break-words text-[16px] font-semibold text-text tabular-nums">
				{props.value}
			</dd>
			<dd className="break-words text-[12px] text-text-subtle">{props.detail}</dd>
			{props.extraDetail === undefined ? null : (
				<dd className="break-words text-[12px] text-text-subtle">{props.extraDetail}</dd>
			)}
		</dl>
	);
}

function MetricSecondary(props: {
	readonly metric: MetricKey;
	readonly value: null | number;
	readonly previous: null | number | undefined;
	readonly resolved: ResolvedReportingSelection;
	readonly coverage?: null | string | undefined;
	readonly preferences: AnalyticsDisplayPreferences;
}) {
	const display = metricValue(props.metric, props.value, props.preferences);
	return (
		<SecondaryMetric
			value={display.formatted}
			{...(typeof props.coverage === "string" ? { extraDetail: props.coverage } : {})}
			label={fitnessMetricDefinitions[props.metric].label}
			detail={metricChange(
				props.metric,
				props.value,
				props.previous ?? null,
				props.resolved,
				props.preferences,
			)}
		/>
	);
}

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
	const resolved = summary.reporting.resolved;
	const coverage = coverageDetail(current.processing);
	const metricStat = (
		metric: MetricKey,
		value: null | number,
		previousValue: null | number | undefined,
		extraDetail?: string,
	) => {
		const display = metricValue(metric, value, preferences);
		const detail = metricChange(metric, value, previousValue ?? null, resolved, preferences);
		const projectionCoverage =
			(metric === "volume" || metric === "personalBests") && coverage !== null ? (
				<span>{coverage}</span>
			) : null;
		return {
			key: metric,
			value: display.formatted,
			label: fitnessMetricDefinitions[metric].label,
			detail: (
				<span className="flex flex-col gap-0.5 whitespace-normal break-words">
					<span>{detail}</span>
					{extraDetail === undefined ? null : <span>{extraDetail}</span>}
					{projectionCoverage}
				</span>
			),
		};
	};
	const activeDaysDetail = comparisonDetail({
		resolved,
		unit: "days",
		current: current.activeDays,
		previous: previous?.activeDays ?? null,
	});
	const currentCalories = metricValue("calories", current.calories, preferences);

	return (
		<section aria-label="Fitness analytics summary" className="flex min-w-0 flex-col gap-5 font-ui">
			<StatStrip
				compact={compact}
				className="min-w-0"
				stats={[
					metricStat("workouts", current.workouts, previous?.workouts),
					metricStat("sets", current.sets, previous?.sets),
					metricStat(
						"activeDuration",
						current.activeDuration,
						previous?.activeDuration,
						`Known subtotal · ${current.timedWorkouts} workouts with duration · ${current.missingDurationWorkouts} missing`,
					),
					metricStat("volume", current.volume, previous?.volume),
				]}
			/>
			<div
				className={
					compact
						? "grid min-w-0 grid-cols-2 gap-x-4 gap-y-5"
						: "grid min-w-0 grid-cols-5 gap-x-4 gap-y-5"
				}
			>
				<SecondaryMetric
					label="Active days"
					detail={activeDaysDetail}
					value={formatExactValue(current.activeDays, "days")}
				/>
				<SecondaryMetric
					value={currentCalories.formatted}
					label={fitnessMetricDefinitions.calories.label}
					extraDetail={`Known subtotal · ${current.calorieWorkouts} workouts with energy · ${current.missingCalorieWorkouts} missing`}
					detail={metricChange(
						"calories",
						current.calories,
						previous?.calories ?? null,
						resolved,
						preferences,
					)}
				/>
				<MetricSecondary
					coverage={coverage}
					resolved={resolved}
					metric="personalBests"
					preferences={preferences}
					value={current.personalBests}
					previous={previous?.personalBests}
				/>
				<MetricSecondary
					coverage={coverage}
					resolved={resolved}
					metric="personalBestSets"
					preferences={preferences}
					value={current.personalBestSets}
					previous={previous?.personalBestSets}
				/>
				<MetricSecondary
					resolved={resolved}
					preferences={preferences}
					metric="measurementEntries"
					value={current.measurementEntries}
					previous={previous?.measurementEntries}
				/>
				<MetricSecondary
					resolved={resolved}
					preferences={preferences}
					metric="measurementReadings"
					value={current.measurementReadings}
					previous={previous?.measurementReadings}
				/>
				<MetricSecondary
					resolved={resolved}
					metric="repetitions"
					preferences={preferences}
					value={current.repetitions}
					previous={previous?.repetitions}
				/>
				<MetricSecondary
					metric="distance"
					resolved={resolved}
					value={current.distance}
					preferences={preferences}
					previous={previous?.distance}
				/>
				<MetricSecondary
					resolved={resolved}
					metric="setDuration"
					preferences={preferences}
					value={current.setDuration}
					previous={previous?.setDuration}
				/>
				<MetricSecondary
					resolved={resolved}
					metric="plannedRest"
					preferences={preferences}
					value={current.plannedRest}
					previous={previous?.plannedRest}
				/>
			</div>
		</section>
	);
}
