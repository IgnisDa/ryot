import {
	periodCaption,
	type Reported,
	REPORTING_BUCKET_LIMIT,
	type ReportingPeriod,
	selectionForPeriod,
	type TimeZone,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import { type RyotQueryResult, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	ChartCard,
	formatMetric,
	MenuSelect,
	type MetricUnit,
	QueryStatus,
	useValueChange,
} from "@ryot-app/plugin-ui-sdk";
import {
	CalendarHeatmap,
	type ChartView,
	HourlyHistogram,
	PeriodTrendChart,
} from "@ryot-app/plugin-ui-sdk/charts";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useCallback, useMemo, useState } from "react";

import type { MediaAnalyticsFilter } from "../../shared/analytics-recipes";
import { consumptionMeasureUnits } from "../../shared/consumption-allocation";
import {
	consistencyModel,
	entryUnit,
	episodeUnit,
	hourlyModel,
	measureLabels,
	measureUnits,
	type MediaAnalyticsHours,
	type MediaAnalyticsMetric,
	type MediaAnalyticsTrend,
	type SummaryChartsProps,
	titleUnit,
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

const metricLabels: Record<MediaAnalyticsMetric, string> = {
	...measureLabels,
	titleCompletions: "Titles completed",
	activeObservations: "Activity entries",
	episodeCompletions: "Episodes finished",
};

const metricUnit = (metric: MediaAnalyticsMetric): MetricUnit => {
	if (metric === "titleCompletions") {
		return titleUnit;
	}
	if (metric === "episodeCompletions") {
		return episodeUnit;
	}
	return metric === "activeObservations" ? entryUnit : measureUnits[metric];
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

const isMeasure = (metric: MediaAnalyticsMetric) =>
	consumptionMeasureUnits.some((unit) => unit === metric);

const metricDetail = (metric: MediaAnalyticsMetric, value: MetricValue) => {
	if (!isMeasure(metric)) {
		return undefined;
	}
	const parts = [
		...(value.estimated !== null && value.estimated > 0
			? [`${formatMetric(value.estimated, metricUnit(metric))} estimated`]
			: []),
		...(value.missing !== null && value.missing > 0
			? [`${formatMetric(value.missing, entryUnit)} without an amount`]
			: []),
	];
	return parts.length === 0 ? undefined : parts.join(" · ");
};

export function MediaAnalyticsCharts(props: SummaryChartsProps) {
	const { compact } = useRyotViewport();
	const [metric, setMetric] = useState<MediaAnalyticsMetric>("activeObservations");
	const [selectedType, setSelectedType] = useState("all");
	const types = props.summary.current.types;
	const mediaType = types.some((row) => row.mediaType === selectedType) ? selectedType : undefined;
	useValueChange(JSON.stringify(props.input), () => setSelectedType("all"));
	const input = useMemo(
		(): ChartInput => ({ ...props.input, ...(mediaType === undefined ? {} : { mediaType }) }),
		[mediaType, props.input],
	);
	const trendResult = useRyotQuery(mediaAnalyticsTrendQuery, input);
	const hoursResult = useRyotQuery(mediaAnalyticsHoursQuery, input);
	const consistencyResult = useRyotQuery(mediaAnalyticsConsistencyQuery, props.input);

	return (
		<section aria-label="Media analytics charts" className="flex min-w-0 flex-col gap-4 font-ui">
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
				title: `Activity entries · ${periodCaption(day.period)}`,
				selection: selectionForPeriod(data.reporting.selection, day.period),
			});
		},
		[data, onDrill],
	);
	return (
		<ChartCard
			title="Consistency"
			description={
				data === undefined
					? "All media types"
					: `All media types · ${periodCaption(data.current.period)}${data.clipped ? ` · last ${REPORTING_BUCKET_LIMIT} days` : ""}`
			}
		>
			<QueryStatus label="consistency" query={props.result} onRetry={props.result.refetch}>
				{(loaded) => (
					<CalendarHeatmap
						weekStart={1}
						unit={entryUnit}
						onSelect={openDay}
						compact={props.compact}
						days={consistencyModel(loaded, props.timeZone)}
						ariaLabel={`Daily activity entries · ${periodCaption(loaded.current.period)}`}
					/>
				)}
			</QueryStatus>
		</ChartCard>
	);
}

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
	const [view, setView] = useState<ChartView>("chart");
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
		<ChartCard
			title="Time of day"
			description={`${metricLabels[metric]} with an exact time, in ${props.input.timeZone}`}
		>
			<QueryStatus query={props.result} label="hourly activity" onRetry={props.result.refetch}>
				{(loaded) => (
					<HourlyHistogram
						onSelect={openHour}
						compact={props.compact}
						unit={metricUnit(metric)}
						timeZone={props.input.timeZone}
						view={{ value: view, onChange: setView }}
						ariaLabel={`${metricLabels[metric]} by local hour`}
						buckets={hourlyModel(loaded.hours, metric).map((row) => ({
							hour: row.hour,
							value: row.value,
							detail: metricDetail(metric, row),
						}))}
					/>
				)}
			</QueryStatus>
		</ChartCard>
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
	const [view, setView] = useState<ChartView>("chart");
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
		<ChartCard
			title="Activity over time"
			actions={
				<>
					<MenuSelect
						label="Show"
						value={props.metric}
						onChange={props.onMetricChange}
						checkIcon={<AppIcon size={14} name="check" />}
						chevronIcon={<AppIcon size={14} name="chevron-down" />}
						choices={analyticsMetrics.map((value) => ({ value, label: metricLabels[value] }))}
					/>
					<MenuSelect
						label="Type"
						value={props.selectedType}
						onChange={props.onTypeChange}
						checkIcon={<AppIcon size={14} name="check" />}
						chevronIcon={<AppIcon size={14} name="chevron-down" />}
						choices={[
							{ value: "all", label: "All" },
							...props.types.map((row) => ({ label: row.label, value: row.mediaType })),
						]}
					/>
				</>
			}
		>
			<QueryStatus label="trend" query={props.result} onRetry={props.result.refetch}>
				{(loaded) => (
					<PeriodTrendChart
						onSelect={openPeriod}
						compact={props.compact}
						unit={metricUnit(metric)}
						grouping={loaded.grouping}
						timeZone={props.input.timeZone}
						current={points(loaded.current, loaded)}
						view={{ value: view, onChange: setView }}
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
		</ChartCard>
	);
}
