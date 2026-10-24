import { useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import { type RyotQueryResult, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Card,
	Notice,
	Select,
	StatusMessage,
	useValueChange,
} from "@ryot-app/plugin-ui-sdk";
import { CalendarHeatmap, HourlyHistogram, PeriodTrendChart } from "@ryot-app/plugin-ui-sdk/charts";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useState } from "react";

import type { MediaAnalyticsFilter } from "../../shared/analytics-recipes";
import {
	analyticsCalendarInput,
	analyticsWindowInput,
	calendarPeriod,
	consistencyModel,
	formatExactValue,
	hourlyModel,
	type MediaAnalyticsHours,
	type MediaAnalyticsMetric,
	mediaTypeLabel,
	periodCaption,
	type Reported,
	selectionForPeriod,
	type SummaryChartsProps,
	trendModel,
} from "./model";
import {
	type MediaAnalyticsConsistencyPage,
	mediaAnalyticsConsistencyQuery,
	mediaAnalyticsHoursQuery,
	type MediaAnalyticsTrendPage,
	mediaAnalyticsTrendQuery,
} from "./queries";

const analyticsMetrics: readonly MediaAnalyticsMetric[] = [
	"titleCompletions",
	"episodeCompletions",
	"activeObservations",
	"pages",
	"episodes",
	"chapters",
	"volumes",
	"minutes",
];
const isAnalyticsMetric = (value: string): value is MediaAnalyticsMetric =>
	analyticsMetrics.some((metric) => metric === value);

const metricLabels: Record<MediaAnalyticsMetric, string> = {
	pages: "Pages",
	minutes: "Minutes",
	volumes: "Volumes",
	chapters: "Chapters",
	episodes: "Episodes",
	titleCompletions: "Title completions",
	activeObservations: "Active observations",
	episodeCompletions: "Episode completions",
};

const metricUnit = (metric: MediaAnalyticsMetric) => {
	if (metric === "titleCompletions") {
		return "title completions";
	}
	if (metric === "episodeCompletions") {
		return "episode completions";
	}
	if (metric === "activeObservations") {
		return "observations";
	}
	return metric;
};

const metricFilter = (metric: MediaAnalyticsMetric, mediaType: string | undefined) => {
	const filter: MediaAnalyticsFilter = {
		...(mediaType === undefined ? {} : { mediaType }),
		...(metric === "activeObservations" ? { activeOnly: true } : {}),
	};
	return Object.keys(filter).length === 0 ? undefined : filter;
};

type MetricValue = {
	readonly lowerBound: boolean;
	readonly value: null | number;
	readonly known: null | number;
	readonly missing: null | number;
	readonly recorded: null | number;
	readonly estimated: null | number;
};

const metricDetail = (metric: MediaAnalyticsMetric, value: MetricValue) => {
	if (
		metric === "titleCompletions" ||
		metric === "episodeCompletions" ||
		metric === "activeObservations"
	) {
		return value.lowerBound ? "Partial lower bound; not all groups are present." : undefined;
	}
	return [
		`Known observations · ${formatExactValue(value.known, "observations")}`,
		`Recorded · ${formatExactValue(value.recorded, metric)}`,
		`Estimated · ${formatExactValue(value.estimated, metric)}`,
		`Missing observations · ${formatExactValue(value.missing, "observations")}`,
		...(value.lowerBound ? ["Partial lower bound"] : []),
	].join(" · ");
};

const scopeKeyFor = (props: SummaryChartsProps) =>
	JSON.stringify({
		input: props.input,
		anchorDate: props.report.reporting.anchorDate,
		current: props.report.reporting.resolved.current,
		previous: props.report.reporting.resolved.previous,
	});

export function MediaAnalyticsCharts(props: SummaryChartsProps) {
	const { compact } = useRyotViewport();
	const [metric, setMetric] = useState<MediaAnalyticsMetric>("activeObservations");
	const [selectedType, setSelectedType] = useState("all");
	const [trendCursor, setTrendCursor] = useState<string | undefined>();
	const [consistencyCursor, setConsistencyCursor] = useState<string | undefined>();
	const calendarInput = analyticsCalendarInput(props.input, props.report.reporting);
	const windowInput = analyticsWindowInput(props.input, props.report.reporting);
	const availableTypes = props.report.current.items.map((row) => row.mediaType);
	const hasSelectedType = availableTypes.includes(selectedType);
	const mediaType = hasSelectedType ? selectedType : undefined;
	const scopeKey = scopeKeyFor(props);
	const trendInput = {
		...windowInput,
		...(trendCursor === undefined ? {} : { endCursor: trendCursor }),
	};
	const consistencyInput = {
		...windowInput,
		...(consistencyCursor === undefined ? {} : { endCursor: consistencyCursor }),
	};
	const trendResult = useRyotQuery(mediaAnalyticsTrendQuery, trendInput);
	const hoursResult = useRyotQuery(mediaAnalyticsHoursQuery, calendarInput);
	const consistencyResult = useRyotQuery(mediaAnalyticsConsistencyQuery, consistencyInput);
	useValueChange(scopeKey, () => {
		setTrendCursor(undefined);
		setConsistencyCursor(undefined);
		setSelectedType("all");
	});
	useValueChange(props.report.processing, (processing) => {
		if (processing === "ready") {
			trendResult.refetch();
			hoursResult.refetch();
			consistencyResult.refetch();
		}
	});

	return (
		<section aria-label="Media analytics charts" className="flex min-w-0 flex-col gap-4 font-ui">
			<h2 className="text-heading font-semibold text-text">Consumption charts</h2>
			{props.report.processing === "ready" ? null : (
				<Notice tone={props.report.processing === "failed" ? "danger" : "warning"}>
					Consumption charts are unavailable while source repair is {props.report.processing}.
				</Notice>
			)}
			<TrendRegion
				metric={metric}
				compact={compact}
				input={props.input}
				result={trendResult}
				mediaType={mediaType}
				types={availableTypes}
				onDrill={props.onDrill}
				onMetricChange={setMetric}
				onTypeChange={setSelectedType}
				onCursorChange={setTrendCursor}
				processing={props.report.processing}
				selectedType={hasSelectedType ? selectedType : "all"}
			/>
			<div
				className={compact ? "grid min-w-0 grid-cols-1 gap-4" : "grid min-w-0 grid-cols-2 gap-4"}
			>
				<HourlyRegion
					metric={metric}
					compact={compact}
					input={props.input}
					result={hoursResult}
					mediaType={mediaType}
					onDrill={props.onDrill}
					processing={props.report.processing}
				/>
				<ConsistencyRegion
					compact={compact}
					input={props.input}
					onDrill={props.onDrill}
					result={consistencyResult}
					processing={props.report.processing}
					onCursorChange={setConsistencyCursor}
				/>
			</div>
		</section>
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

function QueryRefreshStatus<Data>(props: {
	readonly label: string;
	readonly result: RyotQueryResult<Data>;
}) {
	if (props.result.data !== undefined && props.result.isError) {
		return <RetryNotice noun={props.label} onRetry={props.result.refetch} />;
	}
	return props.result.data !== undefined && props.result.isFetching ? (
		<StatusMessage tone="pending">Refreshing {props.label}…</StatusMessage>
	) : null;
}

function ExtraPreviousValues(props: {
	readonly metric: MediaAnalyticsMetric;
	readonly buckets: ReturnType<typeof trendModel>["extraPrevious"];
}) {
	return (
		<details className="min-w-0 rounded-md border border-border px-3 py-2">
			<summary className="cursor-pointer py-2 text-label font-medium text-text">
				Additional previous-period dates ({props.buckets.length})
			</summary>
			<div className="mt-2 overflow-x-auto">
				<table className="w-full min-w-64 border-collapse text-left text-sm">
					<caption className="sr-only">
						Returned values for additional previous-period dates
					</caption>
					<thead className="text-text-muted">
						<tr>
							<th scope="col" className="py-2 pr-3 font-medium">
								Actual dates
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
							<tr key={bucket.date}>
								<th scope="row" className="py-2 pr-3 font-normal text-text">
									{periodCaption(bucket.period)}
								</th>
								<td className="py-2 pr-3 tabular-nums text-text">
									{formatExactValue(bucket.value, metricUnit(props.metric))}
								</td>
								<td className="py-2 text-text-muted">
									{metricDetail(props.metric, bucket) ?? "Complete returned bucket"}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</details>
	);
}

function HourlyRegion(props: {
	readonly compact: boolean;
	readonly metric: MediaAnalyticsMetric;
	readonly mediaType: string | undefined;
	readonly input: SummaryChartsProps["input"];
	readonly onDrill: SummaryChartsProps["onDrill"];
	readonly processing: SummaryChartsProps["report"]["processing"];
	readonly result: RyotQueryResult<Reported<MediaAnalyticsHours>>;
}) {
	const data = props.result.data;
	const model =
		data === undefined ? null : hourlyModel(data, props.metric, props.processing, props.mediaType);
	const regionName = "hourly activity";
	let chartState: "failed" | "pending" | undefined;
	if (data === undefined) {
		chartState = props.result.isError ? "failed" : "pending";
	}
	const refresh = <QueryRefreshStatus label={regionName} result={props.result} />;
	const reporting = data?.reporting;
	return (
		<Card className="flex min-w-0 flex-col gap-3">
			<h3 className="text-body font-semibold text-text">Hourly observations</h3>
			{refresh}
			<HourlyHistogram
				state={chartState}
				compact={props.compact}
				timeZone={props.input.timeZone}
				ariaLabel={`${metricLabels[props.metric]} by local hour`}
				formatValue={(value) => formatExactValue(value, metricUnit(props.metric))}
				periodLabel={`${metricLabels[props.metric]} · exact instants only · ${reporting === undefined ? "Selected period" : periodCaption(reporting.resolved.current)} · ${props.input.timeZone}`}
				buckets={
					model?.hours.map((row) => {
						const detail = metricDetail(props.metric, row);
						return {
							hour: row.hour,
							value: row.value,
							...(detail === undefined ? {} : { detail }),
						};
					}) ?? []
				}
				{...(chartState === "failed" ? { onRetry: props.result.refetch } : {})}
				{...(data === undefined
					? {}
					: {
							onSelect: (bucket: { readonly hour: number }) => {
								props.onDrill({
									hour: bucket.hour,
									selection: data.reporting.selection,
									periodCaption: periodCaption(data.reporting.resolved.current),
									title: `${metricLabels[props.metric]} at ${String(bucket.hour).padStart(2, "0")}:00`,
									...(props.mediaType === undefined ? {} : { mediaType: props.mediaType }),
									...(props.metric === "activeObservations" ? { activeOnly: true } : {}),
								});
							},
						})}
			/>
			{model?.partial ? (
				<p className="text-sm text-warning">
					Hourly groups are partial. Date-only and unknown-date observations are excluded.
				</p>
			) : (
				<p className="text-sm text-text-muted">
					Only instant-dated observations are grouped by hour. Date-only and unknown dates are
					excluded.
				</p>
			)}
		</Card>
	);
}

function ConsistencyDayTable(props: {
	readonly input: SummaryChartsProps["input"];
	readonly onDrill: SummaryChartsProps["onDrill"];
	readonly model: ReturnType<typeof consistencyModel>;
	readonly selection: undefined | SummaryChartsProps["report"]["reporting"]["selection"];
}) {
	return (
		<details className="min-w-0 rounded-md border border-border px-3 py-2">
			<summary className="cursor-pointer py-2 text-label font-medium text-text">
				View exact daily values ({props.model.days.length} days)
			</summary>
			<div className="mt-2 max-h-80 overflow-auto">
				<table className="w-full min-w-64 border-collapse text-left text-sm">
					<caption className="sr-only">Daily active observations and record links</caption>
					<thead className="sticky top-0 bg-surface text-text-muted">
						<tr>
							<th scope="col" className="py-2 pr-3 font-medium">
								Date
							</th>
							<th scope="col" className="py-2 pr-3 font-medium">
								Active observations
							</th>
							<th scope="col" className="py-2 font-medium">
								Records
							</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-border">
						{props.model.days.map((day) => {
							const period = calendarPeriod(
								{ endDate: day.date, startDate: day.date },
								props.input.timeZone,
							);
							const selection = props.selection;
							const drill =
								day.value === null || selection === undefined || props.model.processing !== "ready"
									? null
									: { activeOnly: true, selection: selectionForPeriod(selection, period) };
							return (
								<tr key={day.date}>
									<th scope="row" className="py-2 pr-3 font-normal text-text">
										{day.date}
									</th>
									<td className="py-2 pr-3 tabular-nums text-text">
										{day.value === null
											? "Unknown"
											: `${props.model.partial ? "≥ " : ""}${formatExactValue(day.value, "observations")}`}
									</td>
									<td className="py-2">
										{drill === null ? (
											<span className="text-text-muted">Unavailable</span>
										) : (
											<Button
												variant="link"
												aria-label={`View records for ${day.date}`}
												onClick={() => {
													props.onDrill({
														selection: drill.selection,
														activeOnly: drill.activeOnly,
														periodCaption: periodCaption(period),
														title: `Active observations · ${day.date}`,
													});
												}}
											>
												View records
											</Button>
										)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</details>
	);
}

function ConsistencyRegion(props: {
	readonly compact: boolean;
	readonly input: SummaryChartsProps["input"];
	readonly onDrill: SummaryChartsProps["onDrill"];
	readonly onCursorChange: (cursor: string | undefined) => void;
	readonly processing: SummaryChartsProps["report"]["processing"];
	readonly result: RyotQueryResult<MediaAnalyticsConsistencyPage>;
}) {
	const data = props.result.data;
	const model = data === undefined ? null : consistencyModel(data, props.processing);
	const allDaysKnown = model?.days.every((day) => day.value !== null) ?? false;
	const canPlot = model?.processing === "ready" && !model.partial && !data?.hasMore && allDaysKnown;
	const window = data?.window;
	let chartContent;
	if (data === undefined) {
		chartContent = props.result.isError ? (
			<StatusMessage
				tone="error"
				action={{ label: "Retry consistency", onClick: props.result.refetch }}
			>
				Consistency data could not be loaded.
			</StatusMessage>
		) : (
			<StatusMessage tone="pending">Loading consistency data…</StatusMessage>
		);
	} else if (canPlot) {
		chartContent = (
			<CalendarHeatmap
				weekStart={1}
				compact={props.compact}
				ariaLabel={`Daily active observations · ${periodCaption(model.period)}`}
				days={model.days.filter(
					(day): day is { readonly date: string; readonly value: number } => day.value !== null,
				)}
				formatTooltip={({ date, value }) =>
					`${value === 0 ? "No active observations" : `${value} active observations`} on ${date}`
				}
			/>
		);
	} else {
		chartContent = (
			<Notice tone="warning">
				Consistency values are partial or unknown. The heatmap is hidden so unknown days are not
				shown as zero.
			</Notice>
		);
	}
	const refresh = <QueryRefreshStatus label="consistency" result={props.result} />;
	return (
		<Card className="flex min-w-0 flex-col gap-3">
			<h3 className="text-body font-semibold text-text">Daily consistency</h3>
			{refresh}
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-sm text-text-muted">
					{window === undefined ? "Window dates unavailable" : periodCaption(window.period)}
				</p>
				<div className="flex gap-2">
					<Button
						variant="secondary"
						disabled={window?.previousCursor === null || window === undefined}
						onClick={() => props.onCursorChange(window?.previousCursor ?? undefined)}
					>
						Older days
					</Button>
					<Button
						variant="secondary"
						disabled={window?.nextCursor === null || window === undefined}
						onClick={() => props.onCursorChange(window?.nextCursor ?? undefined)}
					>
						Newer days
					</Button>
				</div>
			</div>
			<p className="text-sm text-text-muted">Active observations · All media types</p>
			{chartContent}
			{model?.partial || data?.hasMore ? (
				<p className="text-sm text-warning">
					This 400-day-bounded window is partial. Unreturned dates are unknown, not zero.
				</p>
			) : null}
			{model !== null ? (
				<ConsistencyDayTable
					model={model}
					input={props.input}
					onDrill={props.onDrill}
					selection={data?.reporting.selection}
				/>
			) : null}
		</Card>
	);
}

function TrendRegion(props: {
	readonly compact: boolean;
	readonly selectedType: string;
	readonly types: readonly string[];
	readonly metric: MediaAnalyticsMetric;
	readonly mediaType: string | undefined;
	readonly input: SummaryChartsProps["input"];
	readonly onDrill: SummaryChartsProps["onDrill"];
	readonly onTypeChange: (mediaType: string) => void;
	readonly result: RyotQueryResult<MediaAnalyticsTrendPage>;
	readonly onCursorChange: (cursor: string | undefined) => void;
	readonly processing: SummaryChartsProps["report"]["processing"];
	readonly onMetricChange: (metric: MediaAnalyticsMetric) => void;
}) {
	const data = props.result.data;
	const model =
		data === undefined
			? null
			: trendModel(
					data.current,
					data.previous,
					props.metric,
					props.processing,
					props.input.timeZone,
					props.mediaType,
				);
	const period = data?.current.period ?? null;
	const previousPeriod = data?.previous?.period ?? null;
	let chartState: "failed" | "pending" | undefined;
	if (data === undefined) {
		chartState = props.result.isError ? "failed" : "pending";
	}
	const openPeriod = (at: string, which: "current" | "comparison") => {
		const bucket =
			which === "current"
				? model?.current.buckets.find((row) => row.date === at)
				: model?.previous?.buckets.find((row) => row.date === at);
		if (bucket === undefined || data === undefined) {
			return;
		}
		const caption = periodCaption(bucket.period);
		const filter = metricFilter(props.metric, props.mediaType);
		props.onDrill({
			periodCaption: caption,
			title: `${metricLabels[props.metric]} · ${caption}`,
			selection: selectionForPeriod(data.reporting.selection, bucket.period),
			...filter,
		});
	};
	const refresh = <QueryRefreshStatus label="trend" result={props.result} />;
	const window = data?.window;
	return (
		<Card className="flex min-w-0 flex-col gap-4">
			<header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h3 className="text-body font-semibold text-text">Consumption trend</h3>
					<p className="text-sm text-text-muted">
						Trend window · {window === undefined ? "Selected period" : periodCaption(window.period)}
					</p>
				</div>
				<div className="flex min-w-0 flex-wrap gap-2">
					<Select
						label="Trend metric"
						value={props.metric}
						className="w-full max-w-xs"
						checkIcon={<AppIcon size={14} name="check" />}
						chevronIcon={<AppIcon size={14} name="chevron-down" />}
						choices={analyticsMetrics.map((value) => ({ value, label: metricLabels[value] }))}
						onChange={(value) => {
							if (isAnalyticsMetric(value)) {
								props.onMetricChange(value);
							}
						}}
					/>
					<Select
						label="Media type"
						value={props.selectedType}
						className="w-full max-w-xs"
						onChange={props.onTypeChange}
						checkIcon={<AppIcon size={14} name="check" />}
						chevronIcon={<AppIcon size={14} name="chevron-down" />}
						choices={[
							{ value: "all", label: "All media types" },
							...props.types.map((value) => ({ value, label: mediaTypeLabel(value) })),
						]}
					/>
				</div>
			</header>
			{refresh}
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="text-sm text-text-muted">
					{window === undefined ? "Window dates unavailable" : periodCaption(window.period)}
				</span>
				<div className="flex gap-2">
					<Button
						variant="secondary"
						disabled={window?.previousCursor === null || window === undefined}
						onClick={() => props.onCursorChange(window?.previousCursor ?? undefined)}
					>
						Older periods
					</Button>
					<Button
						variant="secondary"
						disabled={window?.nextCursor === null || window === undefined}
						onClick={() => props.onCursorChange(window?.nextCursor ?? undefined)}
					>
						Newer periods
					</Button>
				</div>
			</div>
			<PeriodTrendChart
				state={chartState}
				compact={props.compact}
				timeZone={props.input.timeZone}
				ariaLabel={`${metricLabels[props.metric]} by reporting period`}
				label={period === null ? "Current period" : periodCaption(period)}
				{...(previousPeriod === null ? {} : { comparisonLabel: periodCaption(previousPeriod) })}
				formatValue={(value) => formatExactValue(value, metricUnit(props.metric))}
				buckets={
					model?.buckets.map(({ current, previous }) => {
						const currentDetail = metricDetail(props.metric, current);
						const previousDetail =
							previous === null ? undefined : metricDetail(props.metric, previous);
						return {
							at: current.date,
							value: current.value,
							...(currentDetail === undefined ? {} : { detail: currentDetail }),
							...(previous === null
								? {}
								: {
										comparison: {
											at: previous.date,
											value: previous.value,
											...(previousDetail === undefined ? {} : { detail: previousDetail }),
										},
									}),
						};
					}) ?? []
				}
				{...(chartState === "failed" ? { onRetry: props.result.refetch } : {})}
				{...(model === null
					? {}
					: {
							onSelect: (point: { readonly at: string }, which: "current" | "comparison") =>
								openPeriod(point.at, which),
						})}
			/>
			{model?.partial ? (
				<p className="text-sm text-warning">
					Trend data is partial. Returned groups are shown; missing groups are not filled with zero.
				</p>
			) : null}
			{model !== null && model.extraPrevious.length > 0 ? (
				<ExtraPreviousValues metric={props.metric} buckets={model.extraPrevious} />
			) : null}
			{model?.previous?.partial ? (
				<p className="text-sm text-warning">
					Additional previous-period groups were truncated. Unreturned dates remain unknown.
				</p>
			) : null}
		</Card>
	);
}
