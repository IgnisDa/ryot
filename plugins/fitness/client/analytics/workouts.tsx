import {
	REPORTING_BUCKET_LIMIT,
	type ReportingPeriod,
	selectionForPeriod,
	usePeriodCaption,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	type Compared,
	type RyotQueryResult,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { ChartCard, MenuSelect, QueryStatus } from "@ryot-app/plugin-ui-sdk";
import {
	CalendarHeatmap,
	type ChartView,
	HourlyHistogram,
	PeriodTrendChart,
} from "@ryot-app/plugin-ui-sdk/charts";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useCallback, useState } from "react";

import { useCountUnits, useFitnessMessages } from "../messages";
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

function HourlyRegion(props: { readonly compact: boolean; readonly input: AnalyticsScope }) {
	const text = useFitnessMessages();
	const workoutUnit = useCountUnits()("workout");
	const result = useRyotQuery(workoutStartsByHourQuery, props.input);
	return (
		<ChartCard
			title={text("client.analytics.workouts.start-times")}
			description={
				result.data === undefined
					? text("client.analytics.workouts.start-times-description")
					: text("client.analytics.workouts.start-times-description-zone", {
							timeZone: result.data.reporting.resolved.timeZone,
						})
			}
		>
			<QueryStatus query={result} onRetry={result.refetch}>
				{(data) => (
					<HourlyHistogram
						unit={workoutUnit}
						compact={props.compact}
						timeZone={data.reporting.resolved.timeZone}
						ariaLabel={text("client.analytics.workouts.start-times-label")}
						buckets={data.hours.map(({ hour, starts }) => ({ hour, value: starts }))}
					/>
				)}
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
	const text = useFitnessMessages();
	const trend = useRyotQuery(analyticsTrendQuery, { ...props.input, metric: props.metric });
	const [view, setView] = useState<ChartView>("chart");
	return (
		<ChartCard
			title={text("client.analytics.workouts.trend")}
			description={text("client.analytics.workouts.trend-description")}
			actions={
				<MenuSelect
					value={props.metric}
					onChange={props.onMetricChange}
					checkIcon={<AppIcon size={14} name="check" />}
					label={text("client.analytics.workouts.trend-show")}
					chevronIcon={<AppIcon size={14} name="chevron-down" />}
					choices={analyticsMetrics.map((value) => ({
						value,
						label: text("client.analytics.metric.label", { metric: value }),
					}))}
				/>
			}
		>
			<TrendChart
				trend={trend}
				metric={props.metric}
				compact={props.compact}
				preferences={props.preferences}
				onOpenWorkouts={props.onOpenWorkouts}
				view={{ value: view, onChange: setView }}
			/>
		</ChartCard>
	);
}

function ConsistencyRegion(props: { readonly compact: boolean; readonly input: AnalyticsScope }) {
	const text = useFitnessMessages();
	const workoutUnit = useCountUnits()("workout");
	const periodCaption = usePeriodCaption();
	const result = useRyotQuery(analyticsConsistencyQuery, props.input);
	const model =
		result.data === undefined
			? null
			: consistencyModel(text, result.data, result.data.reporting.resolved);
	let description = text("client.analytics.workouts.consistency-description");
	if (model !== null) {
		description = model.clipped
			? text("client.analytics.workouts.consistency-description-clipped", {
					days: REPORTING_BUCKET_LIMIT,
					period: periodCaption(model.period),
				})
			: text("client.analytics.workouts.consistency-description-period", {
					period: periodCaption(model.period),
				});
	}
	return (
		<ChartCard description={description} title={text("client.analytics.workouts.consistency")}>
			<QueryStatus query={result} onRetry={result.refetch}>
				{(data) =>
					model === null ? null : (
						<CalendarHeatmap
							days={model.days}
							unit={workoutUnit}
							compact={props.compact}
							weekStart={data.reporting.resolved.weekStart}
							ariaLabel={text("client.analytics.workouts.consistency-label", {
								period: periodCaption(model.period),
							})}
						/>
					)
				}
			</QueryStatus>
		</ChartCard>
	);
}

function TrendChart(props: {
	readonly compact: boolean;
	readonly trend: TrendQueryResult;
	readonly metric: AnalyticsMetric;
	readonly preferences: AnalyticsDisplayPreferences;
	readonly onOpenWorkouts: (request: WorkoutDrillRequest) => void;
	readonly view: { readonly value: ChartView; readonly onChange: (view: ChartView) => void };
}) {
	const text = useFitnessMessages();
	const units = useCountUnits();
	const periodCaption = usePeriodCaption();
	const data = props.trend.data;
	const model =
		data === undefined
			? null
			: workoutTrendModel(
					{ text, units },
					data.current,
					data.previous,
					data.reporting.resolved,
					props.preferences,
				);
	const { onOpenWorkouts } = props;
	const openBucket = useCallback(
		(bucket: { readonly period: ReportingPeriod }) => {
			if (data !== undefined) {
				onOpenWorkouts({
					periodCaption: periodCaption(bucket.period),
					title: text("client.analytics.workouts.bucket-title"),
					selection: selectionForPeriod(data.reporting.selection, bucket.period),
				});
			}
		},
		[data, onOpenWorkouts, periodCaption, text],
	);
	return (
		<QueryStatus query={props.trend} onRetry={props.trend.refetch}>
			{({ current, previous, reporting }) =>
				model === null ? null : (
					<PeriodTrendChart
						unit={model.unit}
						view={props.view}
						onSelect={openBucket}
						current={model.current}
						compact={props.compact}
						grouping={current.grouping}
						label={periodCaption(current.period)}
						timeZone={reporting.resolved.timeZone}
						ariaLabel={text("client.analytics.workouts.trend-label", {
							metric: text("client.analytics.metric.label", { metric: props.metric }),
						})}
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
