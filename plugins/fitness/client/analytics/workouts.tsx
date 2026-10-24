import { type RyotQueryResult, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button, Card, Notice, Select, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { CalendarHeatmap, HourlyHistogram, PeriodTrendChart } from "@ryot-app/plugin-ui-sdk/charts";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { ReactNode } from "react";
import { useState } from "react";

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
	formatExactValue,
	periodCaption,
	type Reported,
	selectionForPeriod,
	type TrendBucket,
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

type TrendQueryResult = RyotQueryResult<Reported<AnalyticsTrend>>;

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

function RetryNotice(props: { readonly noun: string; readonly onRetry: () => void }) {
	return (
		<Notice
			tone="danger"
			action={
				<Button variant="secondary" onClick={props.onRetry}>
					Retry {props.noun}
				</Button>
			}
		>
			The {props.noun} refresh failed. Showing the last loaded values.
		</Notice>
	);
}

function ComparedTrend(props: {
	readonly compact: boolean;
	readonly input: AnalyticsInput;
	readonly metric: AnalyticsMetric;
	readonly current: TrendQueryResult;
	readonly preferences: AnalyticsDisplayPreferences;
	readonly onOpenWorkouts: (request: WorkoutDrillRequest) => void;
}) {
	const previous = useRyotQuery(analyticsTrendQuery, {
		...props.input,
		period: "previous",
		metric: props.metric,
	});
	return (
		<TrendChart
			previous={previous}
			metric={props.metric}
			compact={props.compact}
			current={props.current}
			timeZone={props.input.timeZone}
			preferences={props.preferences}
			selection={props.input.selection}
			onOpenWorkouts={props.onOpenWorkouts}
		/>
	);
}

function ExtraPreviousValues<
	Point extends { readonly at: string; readonly value: null | number },
>(props: { readonly unit: string; readonly buckets: readonly TrendBucket<Point>[] }) {
	return (
		<details className="min-w-0 rounded-md border border-border px-3 py-2">
			<summary className="cursor-pointer text-label font-medium text-text">
				Additional previous-period values ({props.buckets.length})
			</summary>
			<div className="mt-3 overflow-x-auto">
				<table className="w-full min-w-[18rem] border-collapse text-left text-sm">
					<caption className="sr-only">Exact values for additional previous-period dates</caption>
					<thead className="text-text-muted">
						<tr>
							<th scope="col" className="py-2 pr-3 font-medium">
								Reporting date
							</th>
							<th scope="col" className="py-2 pr-3 font-medium">
								Value
							</th>
							<th scope="col" className="py-2 font-medium">
								Coverage
							</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-border">
						{props.buckets.map((bucket) => (
							<tr key={bucket.at}>
								<th scope="row" className="py-2 pr-3 font-normal text-text">
									{periodCaption(bucket.period)}
								</th>
								<td className="py-2 pr-3 tabular-nums text-text">
									{formatExactValue(bucket.value, props.unit)}
								</td>
								<td className="py-2 text-text-muted">{bucket.detail}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</details>
	);
}

function HourlyRegion(props: { readonly compact: boolean; readonly input: AnalyticsInput }) {
	const result = useRyotQuery(workoutStartsByHourQuery, props.input);
	const data = result.data;
	let queryStatus: ReactNode = null;
	if (data !== undefined && result.isError) {
		queryStatus = <RetryNotice onRetry={result.refetch} noun="hourly workout starts" />;
	} else if (data !== undefined && result.isFetching) {
		queryStatus = <StatusMessage tone="pending">Refreshing hourly workout starts…</StatusMessage>;
	}
	let chartState: "failed" | "pending" | undefined;
	if (data === undefined) {
		chartState = "pending";
		if (result.isError) {
			chartState = "failed";
		}
	}
	return (
		<Card className="flex min-w-0 flex-col gap-3">
			<h2 className="text-body font-semibold text-text">Workout starts</h2>
			{queryStatus}
			<HourlyHistogram
				state={chartState}
				compact={props.compact}
				timeZone={props.input.timeZone}
				ariaLabel="Workout starts by reporting hour"
				formatValue={(value) => formatExactValue(value, "workouts")}
				periodLabel={`Workout starts · ${data === undefined ? "Selected period" : periodCaption(data.reporting.resolved.current)}`}
				buckets={
					data?.hours.map(({ hour, starts }) => ({
						hour,
						value: starts,
						detail: `${starts} workout starts in reporting hour ${hour}`,
					})) ?? []
				}
				{...(data === undefined && result.isError ? { onRetry: result.refetch } : {})}
			/>
			{data?.hasMore ? (
				<p className="text-[12.5px] text-warning">
					Hourly results are partial; not all groups are shown.
				</p>
			) : null}
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
	const current = useRyotQuery(analyticsTrendQuery, {
		...props.input,
		period: "current",
		metric: props.metric,
	});
	const hasPreviousPeriod =
		props.input.selection.comparison !== "none" && props.input.selection.range.kind !== "all-time";
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
			{hasPreviousPeriod ? (
				<ComparedTrend
					current={current}
					input={props.input}
					metric={props.metric}
					compact={props.compact}
					preferences={props.preferences}
					onOpenWorkouts={props.onOpenWorkouts}
				/>
			) : (
				<TrendChart
					current={current}
					metric={props.metric}
					compact={props.compact}
					timeZone={props.input.timeZone}
					preferences={props.preferences}
					selection={props.input.selection}
					onOpenWorkouts={props.onOpenWorkouts}
				/>
			)}
		</Card>
	);
}

function ConsistencyRegion(props: { readonly compact: boolean; readonly input: AnalyticsInput }) {
	const result = useRyotQuery(analyticsConsistencyQuery, props.input);
	const data = result.data;
	const model = data === undefined ? null : consistencyModel(data, props.input.timeZone);
	const knownDays = model?.buckets.every((bucket) => bucket.value !== null) ?? false;
	const canShowHeatmap = model !== null && model.complete && !model.partial && knownDays;
	let queryStatus: ReactNode = null;
	if (data !== undefined && result.isError) {
		queryStatus = <RetryNotice onRetry={result.refetch} noun="workout consistency" />;
	} else if (data !== undefined && result.isFetching) {
		queryStatus = <StatusMessage tone="pending">Refreshing workout consistency…</StatusMessage>;
	}
	let content: ReactNode;
	if (data === undefined) {
		if (result.isError) {
			content = <RetryNotice onRetry={result.refetch} noun="workout consistency" />;
		} else {
			content = <StatusMessage tone="pending">Loading workout consistency…</StatusMessage>;
		}
	} else {
		let heatmap: ReactNode = null;
		if (canShowHeatmap) {
			heatmap = (
				<CalendarHeatmap
					weekStart={1}
					days={model.days}
					compact={props.compact}
					ariaLabel={`Workout starts · ${model.periodCaption}`}
					formatTooltip={({ date, value }) =>
						`${value === 0 ? "No workouts" : `${value} workouts`} on ${date}`
					}
				/>
			);
		} else {
			heatmap = (
				<Notice tone="warning">
					Consistency data is partial. The grid is hidden so unknown days are not shown as zero.
				</Notice>
			);
		}
		content = (
			<>
				<p className="text-[12.5px] text-text-muted">
					Workout starts · {model?.periodCaption ?? periodCaption(data.period)}
				</p>
				{model?.clipped ? (
					<p className="text-[12.5px] text-text-muted">
						Showing the last 26 weeks of the selected period.
					</p>
				) : null}
				{heatmap}
				{model?.partial || data.hasMore ? (
					<p className="text-[12.5px] text-warning">
						Consistency results are partial; they do not describe the full period.
					</p>
				) : null}
			</>
		);
	}
	return (
		<Card className="flex min-w-0 flex-col gap-3">
			<h2 className="text-body font-semibold text-text">Workout consistency</h2>
			{queryStatus}
			{content}
		</Card>
	);
}

function TrendChart(props: {
	readonly compact: boolean;
	readonly timeZone: string;
	readonly metric: AnalyticsMetric;
	readonly current: TrendQueryResult;
	readonly previous?: TrendQueryResult;
	readonly selection: AnalyticsScope["selection"];
	readonly preferences: AnalyticsDisplayPreferences;
	readonly onOpenWorkouts: (request: WorkoutDrillRequest) => void;
}) {
	const currentTrend = props.current.data;
	const previousTrend = props.previous?.data ?? null;
	const model =
		currentTrend === undefined
			? null
			: workoutTrendModel(currentTrend, previousTrend, props.timeZone, props.preferences);
	const currentPeriod = currentTrend?.period ?? null;
	const previousPeriod = previousTrend?.period ?? null;
	const formatValue = (value: number) => formatExactValue(value, model?.unit ?? "");
	let chartState: "failed" | "pending" | undefined;
	if (currentTrend === undefined) {
		chartState = "pending";
		if (props.current.isError) {
			chartState = "failed";
		}
	}
	const hasExtraPrevious = (model?.extraPrevious.length ?? 0) > 0;
	const selectedPeriod = (at: string, period: "current" | "comparison") => {
		const bucket =
			period === "current"
				? model?.current.buckets.find((item) => item.at === at)
				: model?.previous?.buckets.find((item) => item.at === at);
		if (bucket === undefined) {
			return;
		}
		props.onOpenWorkouts({
			title: "Workouts starting in this bucket",
			periodCaption: periodCaption(bucket.period),
			selection: selectionForPeriod(props.selection, bucket.period),
		});
	};
	let currentStatus: ReactNode = null;
	if (currentTrend !== undefined && props.current.isError) {
		currentStatus = (
			<Notice
				tone="danger"
				action={
					<Button variant="secondary" onClick={props.current.refetch}>
						Retry trend
					</Button>
				}
			>
				Trend refresh failed. Showing the last loaded values.
			</Notice>
		);
	} else if (props.current.isFetching && currentTrend !== undefined) {
		currentStatus = <StatusMessage tone="pending">Refreshing workout trend…</StatusMessage>;
	}
	let previousStatus: ReactNode = null;
	if (props.previous?.isError) {
		previousStatus = (
			<Notice
				tone="danger"
				action={
					<Button variant="secondary" onClick={props.previous.refetch}>
						Retry comparison
					</Button>
				}
			>
				The previous-period trend could not be refreshed. Current values remain available.
			</Notice>
		);
	} else if (props.previous !== undefined && props.previous.isFetching && previousTrend !== null) {
		previousStatus = (
			<StatusMessage tone="pending">Refreshing previous-period trend…</StatusMessage>
		);
	} else if (props.previous !== undefined && props.previous.data === undefined) {
		previousStatus = <StatusMessage tone="pending">Loading previous-period trend…</StatusMessage>;
	}

	return (
		<div className="flex min-w-0 flex-col gap-3">
			{currentStatus}
			{previousStatus}
			<PeriodTrendChart
				compact={props.compact}
				timeZone={props.timeZone}
				label={currentPeriod === null ? "Current period" : periodCaption(currentPeriod)}
				ariaLabel={`${fitnessMetricDefinitions[props.metric].label} by workout-start period`}
				{...(previousPeriod !== null ? { comparisonLabel: periodCaption(previousPeriod) } : {})}
				formatValue={formatValue}
				buckets={model?.buckets ?? []}
				{...(chartState === undefined ? {} : { state: chartState })}
				{...(chartState === "failed" ? { onRetry: props.current.refetch } : {})}
				{...(currentTrend === undefined
					? {}
					: {
							onSelect: (point: { readonly at: string }, period: "current" | "comparison") =>
								selectedPeriod(point.at, period),
						})}
			/>
			{model?.partial ? (
				<p className="text-[12.5px] text-warning">
					Trend data is partial. The chart shows returned groups only; it is not a complete-period
					total.
				</p>
			) : null}
			{hasExtraPrevious && model !== null ? (
				<ExtraPreviousValues unit={model.unit} buckets={model.extraPrevious} />
			) : null}
		</div>
	);
}
