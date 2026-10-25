import {
	formatExactValue,
	periodCaption,
	type Reported,
	type ReportingPeriod,
	selectionForPeriod,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import { type RyotQueryResult, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button, Card, Notice, QueryStatus, Select, useValueChange } from "@ryot-app/plugin-ui-sdk";
import { CalendarHeatmap, HourlyHistogram, PeriodTrendChart } from "@ryot-app/plugin-ui-sdk/charts";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useCallback, useState } from "react";

import type { MediaAnalyticsFilter } from "../../shared/analytics-recipes";
import {
	analyticsCalendarInput,
	analyticsWindowInput,
	anchorDateOf,
	consistencyModel,
	hourlyModel,
	type MediaAnalyticsHours,
	type MediaAnalyticsMetric,
	mediaTypeLabel,
	type SummaryChartsProps,
	type TrendBucket,
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
		anchorDate: anchorDateOf(props.report.reporting),
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

const trendPoints = (buckets: ReadonlyArray<TrendBucket>, metric: MediaAnalyticsMetric) =>
	buckets.map((bucket) => ({
		at: bucket.date,
		value: bucket.value,
		period: bucket.period,
		detail: metricDetail(metric, bucket),
	}));

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
	const { metric, onDrill, mediaType } = props;
	const formatValue = useCallback(
		(value: number) => formatExactValue(value, metricUnit(metric)),
		[metric],
	);
	const openHour = useCallback(
		(bucket: { readonly hour: number }) => {
			if (data === undefined) {
				return;
			}
			onDrill({
				hour: bucket.hour,
				selection: data.reporting.selection,
				periodCaption: periodCaption(data.reporting.resolved.current),
				title: `${metricLabels[metric]} at ${String(bucket.hour).padStart(2, "0")}:00`,
				...(mediaType === undefined ? {} : { mediaType }),
				...(metric === "activeObservations" ? { activeOnly: true } : {}),
			});
		},
		[data, metric, mediaType, onDrill],
	);
	return (
		<Card className="flex min-w-0 flex-col gap-3">
			<h3 className="text-body font-semibold text-text">Hourly observations</h3>
			<QueryStatus query={props.result} label="hourly activity" onRetry={props.result.refetch}>
				{(loaded) => (
					<HourlyHistogram
						onSelect={openHour}
						compact={props.compact}
						formatValue={formatValue}
						timeZone={props.input.timeZone}
						ariaLabel={`${metricLabels[metric]} by local hour`}
						periodLabel={`${metricLabels[metric]} · exact instants only · ${periodCaption(loaded.reporting.resolved.current)} · ${props.input.timeZone}`}
						buckets={(model?.hours ?? []).map((row) => ({
							hour: row.hour,
							value: row.value,
							detail: metricDetail(metric, row),
						}))}
					/>
				)}
			</QueryStatus>
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

const formatObservations = (value: number) =>
	value === 0 ? "No active observations" : formatExactValue(value, "active observations");

function ConsistencyRegion(props: {
	readonly compact: boolean;
	readonly input: SummaryChartsProps["input"];
	readonly onDrill: SummaryChartsProps["onDrill"];
	readonly onCursorChange: (cursor: string | undefined) => void;
	readonly processing: SummaryChartsProps["report"]["processing"];
	readonly result: RyotQueryResult<MediaAnalyticsConsistencyPage>;
}) {
	const data = props.result.data;
	const model =
		data === undefined ? null : consistencyModel(data, props.processing, props.input.timeZone);
	const { onDrill } = props;
	const openDay = useCallback(
		(day: { readonly date: string; readonly period: ReportingPeriod }) => {
			if (data === undefined) {
				return;
			}
			onDrill({
				activeOnly: true,
				periodCaption: periodCaption(day.period),
				title: `Active observations · ${day.date}`,
				selection: selectionForPeriod(data.reporting.selection, day.period),
			});
		},
		[data, onDrill],
	);
	const window = data?.window;
	return (
		<Card className="flex min-w-0 flex-col gap-3">
			<h3 className="text-body font-semibold text-text">Daily consistency</h3>
			<QueryStatus label="consistency" query={props.result} onRetry={props.result.refetch} />
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
			{model === null ? null : (
				<CalendarHeatmap
					weekStart={1}
					days={model.days}
					compact={props.compact}
					formatValue={formatObservations}
					onSelect={model.processing === "ready" ? openDay : undefined}
					ariaLabel={`Daily active observations · ${periodCaption(model.period)}`}
				/>
			)}
			{model?.partial ? (
				<p className="text-sm text-warning">
					This 400-day-bounded window is partial. Unreturned dates are unknown, not zero.
				</p>
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
	const { metric, onDrill, mediaType } = props;
	const formatValue = useCallback(
		(value: number) => formatExactValue(value, metricUnit(metric)),
		[metric],
	);
	const openPeriod = useCallback(
		(bucket: { readonly period: ReportingPeriod }) => {
			if (data === undefined) {
				return;
			}
			const caption = periodCaption(bucket.period);
			onDrill({
				periodCaption: caption,
				title: `${metricLabels[metric]} · ${caption}`,
				selection: selectionForPeriod(data.reporting.selection, bucket.period),
				...metricFilter(metric, mediaType),
			});
		},
		[data, metric, mediaType, onDrill],
	);
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
			<QueryStatus label="trend" query={props.result} onRetry={props.result.refetch} />
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
			{data === undefined || model === null ? null : (
				<PeriodTrendChart
					onSelect={openPeriod}
					compact={props.compact}
					formatValue={formatValue}
					timeZone={props.input.timeZone}
					label={periodCaption(data.current.period)}
					current={trendPoints(model.current.buckets, metric)}
					ariaLabel={`${metricLabels[metric]} by reporting period`}
					previous={
						data.previous === null || model.previous === null
							? undefined
							: {
									label: periodCaption(data.previous.period),
									points: trendPoints(model.previous.buckets, metric),
								}
					}
				/>
			)}
			{model?.partial ? (
				<p className="text-sm text-warning">
					Trend data is partial. Returned groups are shown; missing groups are not filled with zero.
				</p>
			) : null}
		</Card>
	);
}
