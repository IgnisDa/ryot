import {
	formatExactValue,
	periodCaption,
	type Reported,
	REPORTING_BUCKET_LIMIT,
	type ReportingPeriod,
	selectionForPeriod,
	type TimeZone,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import { type RyotQueryResult, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Card, QueryStatus, Select, useValueChange } from "@ryot-app/plugin-ui-sdk";
import { CalendarHeatmap, HourlyHistogram, PeriodTrendChart } from "@ryot-app/plugin-ui-sdk/charts";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useCallback, useMemo, useState } from "react";

import type { MediaAnalyticsFilter } from "../../shared/analytics-recipes";
import {
	consistencyModel,
	hourlyModel,
	type MediaAnalyticsHours,
	type MediaAnalyticsMetric,
	type MediaAnalyticsTrend,
	type SummaryChartsProps,
	type TrendBucket,
	trendBuckets,
} from "./model";
import {
	type ChartInput,
	mediaAnalyticsConsistencyQuery,
	mediaAnalyticsHoursQuery,
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
		return undefined;
	}
	return [
		`Known observations · ${formatExactValue(value.known, "observations")}`,
		`Recorded · ${formatExactValue(value.recorded, metric)}`,
		`Estimated · ${formatExactValue(value.estimated, metric)}`,
		`Missing observations · ${formatExactValue(value.missing, "observations")}`,
		...(value.lowerBound ? ["Partial lower bound"] : []),
	].join(" · ");
};

export function MediaAnalyticsCharts(props: SummaryChartsProps) {
	const { compact } = useRyotViewport();
	const [metric, setMetric] = useState<MediaAnalyticsMetric>("activeObservations");
	const [selectedType, setSelectedType] = useState("all");
	const processing = props.summary.processing;
	const types = props.summary.current.types;
	const mediaType = types.some((row) => row.mediaType === selectedType) ? selectedType : undefined;
	useValueChange(JSON.stringify(props.input), () => setSelectedType("all"));
	const input = useMemo(
		(): ChartInput => ({
			...props.input,
			processing,
			...(mediaType === undefined ? {} : { mediaType }),
		}),
		[mediaType, processing, props.input],
	);
	const allTypes = useMemo(
		(): ChartInput => ({ ...props.input, processing }),
		[processing, props.input],
	);
	const trendResult = useRyotQuery(mediaAnalyticsTrendQuery, input);
	const hoursResult = useRyotQuery(mediaAnalyticsHoursQuery, input);
	const consistencyResult = useRyotQuery(mediaAnalyticsConsistencyQuery, allTypes);

	return (
		<section aria-label="Media analytics charts" className="flex min-w-0 flex-col gap-4 font-ui">
			<h2 className="text-heading font-semibold text-text">Consumption charts</h2>
			<TrendRegion
				types={types}
				metric={metric}
				compact={compact}
				input={props.input}
				result={trendResult}
				mediaType={mediaType}
				onDrill={props.onDrill}
				onMetricChange={setMetric}
				onTypeChange={setSelectedType}
				selectedType={mediaType ?? "all"}
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
				/>
				<ConsistencyRegion
					compact={compact}
					onDrill={props.onDrill}
					result={consistencyResult}
					timeZone={props.input.timeZone}
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
	readonly result: RyotQueryResult<Reported<{ readonly hours: MediaAnalyticsHours }>>;
}) {
	const data = props.result.data;
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
				...metricFilter(metric, mediaType),
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
						buckets={hourlyModel(loaded.hours, metric).map((row) => ({
							hour: row.hour,
							value: row.value,
							detail: metricDetail(metric, row),
						}))}
					/>
				)}
			</QueryStatus>
			<p className="text-sm text-text-muted">
				Only instant-dated observations are grouped by hour. Date-only and unknown dates are
				excluded.
			</p>
		</Card>
	);
}

const formatObservations = (value: number) =>
	value === 0 ? "No active observations" : formatExactValue(value, "active observations");

function ConsistencyRegion(props: {
	readonly compact: boolean;
	readonly timeZone: TimeZone;
	readonly onDrill: SummaryChartsProps["onDrill"];
	readonly result: RyotQueryResult<Reported<MediaAnalyticsTrend> & { readonly clipped: boolean }>;
}) {
	const data = props.result.data;
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
	return (
		<Card className="flex min-w-0 flex-col gap-3">
			<h3 className="text-body font-semibold text-text">Daily consistency</h3>
			<QueryStatus label="consistency" query={props.result} onRetry={props.result.refetch}>
				{(loaded) => (
					<>
						<p className="text-sm text-text-muted">
							Active observations · All media types · {periodCaption(loaded.current.period)}
						</p>
						<CalendarHeatmap
							weekStart={1}
							onSelect={openDay}
							compact={props.compact}
							formatValue={formatObservations}
							days={consistencyModel(loaded, props.timeZone)}
							ariaLabel={`Daily active observations · ${periodCaption(loaded.current.period)}`}
						/>
						{loaded.clipped ? (
							<p className="text-sm text-text-muted">
								Showing the most recent {REPORTING_BUCKET_LIMIT} days of the selected period.
							</p>
						) : null}
					</>
				)}
			</QueryStatus>
		</Card>
	);
}

function TrendRegion(props: {
	readonly compact: boolean;
	readonly selectedType: string;
	readonly metric: MediaAnalyticsMetric;
	readonly mediaType: string | undefined;
	readonly input: SummaryChartsProps["input"];
	readonly onDrill: SummaryChartsProps["onDrill"];
	readonly onTypeChange: (mediaType: string) => void;
	readonly result: RyotQueryResult<Reported<MediaAnalyticsTrend>>;
	readonly onMetricChange: (metric: MediaAnalyticsMetric) => void;
	readonly types: SummaryChartsProps["summary"]["current"]["types"];
}) {
	const data = props.result.data;
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
	const points = (series: MediaAnalyticsTrend["current"], trend: MediaAnalyticsTrend) =>
		trendPoints(trendBuckets(trend, series, metric, props.input.timeZone), metric);
	return (
		<Card className="flex min-w-0 flex-col gap-4">
			<header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h3 className="text-body font-semibold text-text">Consumption trend</h3>
					<p className="text-sm text-text-muted">
						{data === undefined ? "Selected period" : periodCaption(data.current.period)}
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
							...props.types.map((row) => ({ label: row.label, value: row.mediaType })),
						]}
					/>
				</div>
			</header>
			<QueryStatus label="trend" query={props.result} onRetry={props.result.refetch}>
				{(loaded) => (
					<PeriodTrendChart
						onSelect={openPeriod}
						compact={props.compact}
						formatValue={formatValue}
						timeZone={props.input.timeZone}
						current={points(loaded.current, loaded)}
						label={periodCaption(loaded.current.period)}
						ariaLabel={`${metricLabels[metric]} by reporting period`}
						previous={
							loaded.previous === null
								? undefined
								: {
										points: points(loaded.previous, loaded),
										label: periodCaption(loaded.previous.period),
									}
						}
					/>
				)}
			</QueryStatus>
		</Card>
	);
}
