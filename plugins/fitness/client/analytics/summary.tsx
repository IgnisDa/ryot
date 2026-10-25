import { compareValues, formatExactValue, periodCaption } from "@ryot-app/plugin-client-sdk/plugin";
import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button, Notice, StatStrip, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import type { ReactNode } from "react";

import { fitnessMetricDefinitions } from "../../shared/fitness-metrics";
import { analyticsSummaryQuery } from "./queries";
import {
	type AnalyticsDisplayPreferences,
	type AnalyticsScope,
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

const changeDetail = (
	metric: null | MetricKey,
	current: null | number,
	previous: null | number,
	unit: string,
	currentCaption: string,
	previousCaption: null | string,
	preferences: AnalyticsDisplayPreferences,
) => {
	if (previousCaption === null) {
		return `${currentCaption} · No comparison`;
	}
	const currentValue =
		metric === null ? current : metricDisplay(metric, current, preferences).value;
	const previousValue =
		metric === null ? previous : metricDisplay(metric, previous, preferences).value;
	const comparison = compareValues(currentValue, previousValue);
	const periods = `${currentCaption} vs ${previousCaption}`;
	if (comparison.kind === "unknown") {
		return `${periods} · Change unavailable`;
	}
	if (comparison.kind === "new-activity") {
		return `${periods} · New activity · +${formatExactValue(comparison.absolute, unit)}`;
	}
	const delta = `${comparison.absolute > 0 ? "+" : ""}${formatExactValue(comparison.absolute, unit)}`;
	const percent =
		comparison.percent === null ? "" : ` (${formatExactValue(comparison.percent, "%")})`;
	return `${periods} · ${delta}${percent}`;
};

const coverageDetail = (pending: number, failed: number) =>
	pending + failed === 0
		? null
		: `Derived values unavailable · ${pending} pending sets · ${failed} failed sets`;

export function AnalyticsSummary({
	scope,
	compact,
	preferences,
}: {
	readonly compact: boolean;
	readonly scope: AnalyticsScope;
	readonly preferences: AnalyticsDisplayPreferences;
}) {
	const result = useRyotQuery(analyticsSummaryQuery, {
		reference: scope.owner,
		timeZone: scope.timeZone,
		selection: scope.selection,
	});
	const summary = result.data;
	if (summary === undefined) {
		if (result.isError) {
			return (
				<div className="flex flex-col items-start gap-3">
					<StatusMessage tone="error">Fitness analytics summary could not be loaded.</StatusMessage>
					<Button variant="secondary" onClick={result.refetch}>
						Retry summary
					</Button>
				</div>
			);
		}
		return <StatusMessage tone="pending">Loading Fitness analytics summary…</StatusMessage>;
	}

	const current = summary.current;
	const previous = summary.previous;
	const currentCaption = periodCaption(summary.reporting.resolved.current);
	const previousCaption =
		summary.reporting.resolved.previous === null
			? null
			: periodCaption(summary.reporting.resolved.previous);
	const coverage = coverageDetail(current.pendingSets, current.failedSets);
	const metricStat = (
		metric: MetricKey,
		value: null | number,
		previousValue: null | number | undefined,
		extraDetail?: string,
	) => {
		const display = metricValue(metric, value, preferences);
		const detail = changeDetail(
			metric,
			value,
			previousValue ?? null,
			display.unit,
			currentCaption,
			previousCaption,
			preferences,
		);
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
	const activeDaysDetail = changeDetail(
		null,
		current.activeDays,
		previous?.activeDays ?? null,
		"days",
		currentCaption,
		previousCaption,
		preferences,
	);
	const currentCalories = metricValue("calories", current.calories, preferences);
	let refreshStatus: ReactNode = null;
	if (result.isError) {
		refreshStatus = (
			<Notice
				tone="danger"
				action={
					<Button variant="secondary" onClick={result.refetch}>
						Retry summary
					</Button>
				}
			>
				The refresh failed. Showing the last loaded summary.
			</Notice>
		);
	} else if (result.isFetching) {
		refreshStatus = (
			<StatusMessage tone="pending">Refreshing Fitness analytics summary…</StatusMessage>
		);
	}

	return (
		<section aria-label="Fitness analytics summary" className="flex min-w-0 flex-col gap-5 font-ui">
			{refreshStatus}
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
					detail={changeDetail(
						"calories",
						current.calories,
						previous?.calories ?? null,
						currentCalories.unit,
						currentCaption,
						previousCaption,
						preferences,
					)}
				/>
				<MetricSecondary
					coverage={coverage}
					metric="personalBests"
					preferences={preferences}
					value={current.personalBests}
					currentCaption={currentCaption}
					previousCaption={previousCaption}
					previous={previous?.personalBests}
				/>
				<MetricSecondary
					coverage={coverage}
					metric="personalBestSets"
					preferences={preferences}
					currentCaption={currentCaption}
					value={current.personalBestSets}
					previousCaption={previousCaption}
					previous={previous?.personalBestSets}
				/>
				<MetricSecondary
					preferences={preferences}
					metric="measurementEntries"
					currentCaption={currentCaption}
					previousCaption={previousCaption}
					value={current.measurementEntries}
					previous={previous?.measurementEntries}
				/>
				<MetricSecondary
					preferences={preferences}
					metric="measurementReadings"
					currentCaption={currentCaption}
					previousCaption={previousCaption}
					value={current.measurementReadings}
					previous={previous?.measurementReadings}
				/>
				<MetricSecondary
					metric="repetitions"
					preferences={preferences}
					value={current.repetitions}
					currentCaption={currentCaption}
					previous={previous?.repetitions}
					previousCaption={previousCaption}
				/>
				<MetricSecondary
					metric="distance"
					value={current.distance}
					preferences={preferences}
					previous={previous?.distance}
					currentCaption={currentCaption}
					previousCaption={previousCaption}
				/>
				<MetricSecondary
					metric="setDuration"
					preferences={preferences}
					value={current.setDuration}
					currentCaption={currentCaption}
					previous={previous?.setDuration}
					previousCaption={previousCaption}
				/>
				<MetricSecondary
					metric="plannedRest"
					preferences={preferences}
					value={current.plannedRest}
					currentCaption={currentCaption}
					previous={previous?.plannedRest}
					previousCaption={previousCaption}
				/>
			</div>
			<p className="text-[12.5px] text-text-muted">
				Taxonomy coverage: {current.missingTaxonomySets} sets lack occurrence evidence;{" "}
				{current.legacyTaxonomySets} sets use legacy export-time taxonomy.
			</p>
		</section>
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
	readonly currentCaption: string;
	readonly previousCaption: null | string;
	readonly previous: null | number | undefined;
	readonly coverage?: null | string | undefined;
	readonly preferences: AnalyticsDisplayPreferences;
}) {
	const display = metricValue(props.metric, props.value, props.preferences);
	return (
		<SecondaryMetric
			value={display.formatted}
			{...(typeof props.coverage === "string" ? { extraDetail: props.coverage } : {})}
			label={fitnessMetricDefinitions[props.metric].label}
			detail={changeDetail(
				props.metric,
				props.value,
				props.previous ?? null,
				display.unit,
				props.currentCaption,
				props.previousCaption,
				props.preferences,
			)}
		/>
	);
}
