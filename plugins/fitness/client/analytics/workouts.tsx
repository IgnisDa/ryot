import {
	formatExactValue,
	periodCaption,
	type ReportingPeriod,
	selectionForPeriod,
	type TimeZone,
} from "@ryot-app/plugin-client-sdk/plugin";
import { type RyotQueryResult, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Card, QueryStatus, Select } from "@ryot-app/plugin-ui-sdk";
import { CalendarHeatmap, HourlyHistogram, PeriodTrendChart } from "@ryot-app/plugin-ui-sdk/charts";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useCallback, useState } from "react";

import { fitnessMetricDefinitions } from "../../shared/fitness-metrics";
import {
	analyticsConsistencyQuery,
	analyticsTrendQuery,
	workoutStartsByHourQuery,
} from "./queries";
import {
	type AnalyticsDisplayPreferences,
	type AnalyticsMetric,
	type AnalyticsScope,
	type AnalyticsTrend,
	type Compared,
	consistencyModel,
	type WorkoutDrillRequest,
	workoutTrendModel,
} from "./reporting-model";

const analyticsMetrics: readonly AnalyticsMetric[] = [
	"workouts",
	"sets",
	"volume",
	"repetitions",
	"distance",
	"activeDuration",
	"calories",
	"setDuration",
	"plannedRest",
	"personalBests",
];
const isAnalyticsMetric = (value: string): value is AnalyticsMetric =>
	analyticsMetrics.some((metric) => metric === value);

type TrendQueryResult = RyotQueryResult<Compared<AnalyticsTrend>>;

type AnalyticsInput = {
	readonly reference: AnalyticsScope["owner"];
	readonly timeZone: AnalyticsScope["timeZone"];
	readonly selection: AnalyticsScope["selection"];
};

export function AnalyticsWorkouts({
	scope,
	compact,
	preferences,
	onOpenWorkouts,
}: {
	readonly compact: boolean;
	readonly scope: AnalyticsScope;
	readonly preferences: AnalyticsDisplayPreferences;
	readonly onOpenWorkouts: (request: WorkoutDrillRequest) => void;
}) {
	const [metric, setMetric] = useState<AnalyticsMetric>("workouts");
	const input: AnalyticsInput = {
		reference: scope.owner,
		timeZone: scope.timeZone,
		selection: scope.selection,
	};
	return (
		<div className="flex min-w-0 flex-col gap-6 font-ui">
			<TrendRegion
				input={input}
				metric={metric}
				compact={compact}
				preferences={preferences}
				onMetricChange={setMetric}
				onOpenWorkouts={onOpenWorkouts}
			/>
			<div
				className={compact ? "grid min-w-0 grid-cols-1 gap-5" : "grid min-w-0 grid-cols-2 gap-5"}
			>
				<HourlyRegion input={input} compact={compact} />
				<ConsistencyRegion input={input} compact={compact} />
			</div>
		</div>
	);
}

const formatWorkouts = (value: number) => formatExactValue(value, "workouts");

function HourlyRegion(props: { readonly compact: boolean; readonly input: AnalyticsInput }) {
	const result = useRyotQuery(workoutStartsByHourQuery, props.input);
	return (
		<Card className="flex min-w-0 flex-col gap-3">
			<h2 className="text-body font-semibold text-text">Workout starts</h2>
			<QueryStatus query={result} onRetry={result.refetch} label="hourly workout starts">
				{(data) => (
					<HourlyHistogram
						compact={props.compact}
						formatValue={formatWorkouts}
						timeZone={props.input.timeZone}
						ariaLabel="Workout starts by reporting hour"
						periodLabel={`Workout starts · ${periodCaption(data.reporting.resolved.current)}`}
						buckets={data.hours.map(({ hour, starts }) => ({
							hour,
							value: starts,
							detail: `${starts} workout starts in reporting hour ${hour}`,
						}))}
					/>
				)}
			</QueryStatus>
		</Card>
	);
}

function ConsistencyRegion(props: { readonly compact: boolean; readonly input: AnalyticsInput }) {
	const result = useRyotQuery(analyticsConsistencyQuery, props.input);
	return (
		<Card className="flex min-w-0 flex-col gap-3">
			<h2 className="text-body font-semibold text-text">Workout consistency</h2>
			<QueryStatus query={result} onRetry={result.refetch} label="workout consistency">
				{(data) => {
					const model = consistencyModel(data, props.input.timeZone);
					return (
						<>
							<p className="text-[12.5px] text-text-muted">
								Workout starts · {model.periodCaption}
							</p>
							{model.clipped ? (
								<p className="text-[12.5px] text-text-muted">
									Showing the last 26 weeks of the selected period.
								</p>
							) : null}
							<CalendarHeatmap
								weekStart={1}
								days={model.days}
								compact={props.compact}
								formatValue={formatWorkouts}
								ariaLabel={`Workout starts · ${model.periodCaption}`}
							/>
						</>
					);
				}}
			</QueryStatus>
		</Card>
	);
}

function TrendRegion(props: {
	readonly compact: boolean;
	readonly input: AnalyticsInput;
	readonly metric: AnalyticsMetric;
	readonly preferences: AnalyticsDisplayPreferences;
	readonly onMetricChange: (metric: AnalyticsMetric) => void;
	readonly onOpenWorkouts: (request: WorkoutDrillRequest) => void;
}) {
	const trend = useRyotQuery(analyticsTrendQuery, { ...props.input, metric: props.metric });
	return (
		<Card className="flex min-w-0 flex-col gap-4">
			<header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
				<div className="min-w-0">
					<h2 className="text-body font-semibold text-text">Workout trend</h2>
					<p className="text-[12.5px] text-text-muted">
						Select a metric. Workout periods use the workout start date.
					</p>
				</div>
				<Select
					label="Trend metric"
					value={props.metric}
					checkIcon={<AppIcon size={14} name="check" />}
					chevronIcon={<AppIcon size={14} name="chevron-down" />}
					className="w-full max-w-xs [&>span:first-child]:text-base"
					onChange={(value) => {
						if (isAnalyticsMetric(value)) {
							props.onMetricChange(value);
						}
					}}
					choices={analyticsMetrics.map((value) => ({
						value,
						label: fitnessMetricDefinitions[value].label,
					}))}
				/>
			</header>
			<TrendChart
				trend={trend}
				metric={props.metric}
				compact={props.compact}
				timeZone={props.input.timeZone}
				preferences={props.preferences}
				selection={props.input.selection}
				onOpenWorkouts={props.onOpenWorkouts}
			/>
		</Card>
	);
}

function TrendChart(props: {
	readonly compact: boolean;
	readonly timeZone: TimeZone;
	readonly trend: TrendQueryResult;
	readonly metric: AnalyticsMetric;
	readonly selection: AnalyticsScope["selection"];
	readonly preferences: AnalyticsDisplayPreferences;
	readonly onOpenWorkouts: (request: WorkoutDrillRequest) => void;
}) {
	const data = props.trend.data;
	const model =
		data === undefined
			? null
			: workoutTrendModel(data.current, data.previous, props.timeZone, props.preferences);
	const unit = model?.unit ?? "";
	const formatValue = useCallback((value: number) => formatExactValue(value, unit), [unit]);
	const { selection, onOpenWorkouts } = props;
	const openBucket = useCallback(
		(bucket: { readonly period: ReportingPeriod }) =>
			onOpenWorkouts({
				title: "Workouts starting in this bucket",
				periodCaption: periodCaption(bucket.period),
				selection: selectionForPeriod(selection, bucket.period),
			}),
		[onOpenWorkouts, selection],
	);
	return (
		<QueryStatus query={props.trend} label="workout trend" onRetry={props.trend.refetch}>
			{({ current, previous }) =>
				model === null ? null : (
					<PeriodTrendChart
						onSelect={openBucket}
						current={model.current}
						compact={props.compact}
						formatValue={formatValue}
						timeZone={props.timeZone}
						label={periodCaption(current.period)}
						ariaLabel={`${fitnessMetricDefinitions[props.metric].label} by workout-start period`}
						previous={
							previous === null || model.previous === null
								? undefined
								: { points: model.previous, label: periodCaption(previous.period) }
						}
					/>
				)
			}
		</QueryStatus>
	);
}
