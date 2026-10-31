import {
	periodCaption,
	REPORTING_BUCKET_LIMIT,
	type ReportingPeriod,
	selectionForPeriod,
	type TimeZone,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	type Compared,
	type RyotQueryResult,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { ChartCard, countUnit, MenuSelect, QueryStatus } from "@ryot-app/plugin-ui-sdk";
import {
	CalendarHeatmap,
	type ChartView,
	HourlyHistogram,
	PeriodTrendChart,
} from "@ryot-app/plugin-ui-sdk/charts";
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

type TrendQueryResult = RyotQueryResult<Compared<AnalyticsTrend>>;

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
	return (
		<div className="flex min-w-0 flex-col gap-6 font-ui">
			<TrendRegion
				input={scope}
				metric={metric}
				compact={compact}
				preferences={preferences}
				onMetricChange={setMetric}
				onOpenWorkouts={onOpenWorkouts}
			/>
			<div
				className={compact ? "grid min-w-0 grid-cols-1 gap-5" : "grid min-w-0 grid-cols-2 gap-5"}
			>
				<HourlyRegion input={scope} compact={compact} />
				<ConsistencyRegion input={scope} compact={compact} />
			</div>
		</div>
	);
}

const workoutUnit = countUnit("workout");

function HourlyRegion(props: { readonly compact: boolean; readonly input: AnalyticsScope }) {
	const result = useRyotQuery(workoutStartsByHourQuery, props.input);
	return (
		<ChartCard
			title="Start times"
			description={`Workout starts by hour, in ${props.input.timeZone}`}
		>
			<QueryStatus query={result} onRetry={result.refetch} label="hourly workout starts">
				{(data) => (
					<HourlyHistogram
						unit={workoutUnit}
						compact={props.compact}
						timeZone={props.input.timeZone}
						ariaLabel="Workout starts by reporting hour"
						buckets={data.hours.map(({ hour, starts }) => ({ hour, value: starts }))}
					/>
				)}
			</QueryStatus>
		</ChartCard>
	);
}

function ConsistencyRegion(props: { readonly compact: boolean; readonly input: AnalyticsScope }) {
	const result = useRyotQuery(analyticsConsistencyQuery, props.input);
	const model =
		result.data === undefined ? null : consistencyModel(result.data, props.input.timeZone);
	return (
		<ChartCard
			title="Consistency"
			description={
				model === null
					? "Workout starts per day"
					: `Workout starts per day · ${model.periodCaption}${model.clipped ? ` · last ${REPORTING_BUCKET_LIMIT} days` : ""}`
			}
		>
			<QueryStatus query={result} onRetry={result.refetch} label="workout consistency">
				{() =>
					model === null ? null : (
						<CalendarHeatmap
							weekStart={1}
							days={model.days}
							unit={workoutUnit}
							compact={props.compact}
							ariaLabel={`Workout starts · ${model.periodCaption}`}
						/>
					)
				}
			</QueryStatus>
		</ChartCard>
	);
}

function TrendRegion(props: {
	readonly compact: boolean;
	readonly input: AnalyticsScope;
	readonly metric: AnalyticsMetric;
	readonly preferences: AnalyticsDisplayPreferences;
	readonly onMetricChange: (metric: AnalyticsMetric) => void;
	readonly onOpenWorkouts: (request: WorkoutDrillRequest) => void;
}) {
	const trend = useRyotQuery(analyticsTrendQuery, { ...props.input, metric: props.metric });
	const [view, setView] = useState<ChartView>("chart");
	return (
		<ChartCard
			title="Workout trend"
			description="Grouped by workout start date"
			actions={
				<MenuSelect
					label="Show"
					value={props.metric}
					onChange={props.onMetricChange}
					checkIcon={<AppIcon size={14} name="check" />}
					chevronIcon={<AppIcon size={14} name="chevron-down" />}
					choices={analyticsMetrics.map((value) => ({
						value,
						label: fitnessMetricDefinitions[value].label,
					}))}
				/>
			}
		>
			<TrendChart
				trend={trend}
				metric={props.metric}
				compact={props.compact}
				timeZone={props.input.timeZone}
				preferences={props.preferences}
				onOpenWorkouts={props.onOpenWorkouts}
				view={{ value: view, onChange: setView }}
			/>
		</ChartCard>
	);
}

function TrendChart(props: {
	readonly compact: boolean;
	readonly timeZone: TimeZone;
	readonly trend: TrendQueryResult;
	readonly metric: AnalyticsMetric;
	readonly preferences: AnalyticsDisplayPreferences;
	readonly onOpenWorkouts: (request: WorkoutDrillRequest) => void;
	readonly view: { readonly value: ChartView; readonly onChange: (view: ChartView) => void };
}) {
	const data = props.trend.data;
	const model =
		data === undefined
			? null
			: workoutTrendModel(data.current, data.previous, props.timeZone, props.preferences);
	const { onOpenWorkouts } = props;
	const openBucket = useCallback(
		(bucket: { readonly period: ReportingPeriod }) => {
			if (data !== undefined) {
				onOpenWorkouts({
					title: "Workouts starting in this bucket",
					periodCaption: periodCaption(bucket.period),
					selection: selectionForPeriod(data.reporting.selection, bucket.period),
				});
			}
		},
		[data, onOpenWorkouts],
	);
	return (
		<QueryStatus query={props.trend} label="workout trend" onRetry={props.trend.refetch}>
			{({ current, previous }) =>
				model === null ? null : (
					<PeriodTrendChart
						unit={model.unit}
						view={props.view}
						onSelect={openBucket}
						current={model.current}
						compact={props.compact}
						timeZone={props.timeZone}
						grouping={current.grouping}
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
