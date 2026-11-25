import {
	type Reported,
	REPORTING_BUCKET_LIMIT,
	type ReportingPeriod,
	selectionForPeriod,
	usePeriodCaption,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	type RyotQueryResult,
	useFormatters,
	useRyotQuery,
	useT,
} from "@ryot-app/plugin-client-sdk/react";
import {
	ChartCard,
	type MetricFormat,
	type MetricUnit,
	QueryStatus,
	Select,
	useMetricFormat,
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

import { consumptionMeasureUnits } from "../../shared/consumption-allocation";
import { type MediaText, useMediaMessages } from "../messages";
import {
	type AnalyticsDrillMediaType,
	analyticsHourLabel,
	consistencyModel,
	hourlyModel,
	measureLabel,
	type MediaAnalyticsHours,
	type MediaAnalyticsMetric,
	type MediaAnalyticsTrend,
	type RecordsDrillRequest,
	type SummaryChartsProps,
	type TrendBucket,
	trendBuckets,
	useAnalyticsUnits,
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

const metricLabel = (text: MediaText, metric: MediaAnalyticsMetric) => {
	if (metric === "titleCompletions") {
		return text("analytics.metric.titles-completed");
	}
	if (metric === "episodeCompletions") {
		return text("analytics.metric.episodes-finished");
	}
	return metric === "activeObservations"
		? text("analytics.metric.activity-entries")
		: measureLabel(text, metric);
};

type AnalyticsUnits = ReturnType<typeof useAnalyticsUnits>;

const metricUnit = (units: AnalyticsUnits, metric: MediaAnalyticsMetric): MetricUnit => {
	if (metric === "titleCompletions") {
		return units.titleUnit;
	}
	if (metric === "episodeCompletions") {
		return units.episodeUnit;
	}
	return metric === "activeObservations" ? units.entryUnit : units.measureUnits[metric];
};

const metricFilter = (
	metric: MediaAnalyticsMetric,
	mediaType: undefined | AnalyticsDrillMediaType,
): Pick<RecordsDrillRequest, "mediaType" | "activeOnly"> => ({
	...(mediaType === undefined ? {} : { mediaType }),
	...(metric === "activeObservations" ? { activeOnly: true } : {}),
});

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

const metricDetail = (
	text: MediaText,
	units: AnalyticsUnits,
	format: MetricFormat,
	metric: MediaAnalyticsMetric,
	value: MetricValue,
) => {
	if (!isMeasure(metric)) {
		return undefined;
	}
	const estimated =
		value.estimated !== null && value.estimated > 0
			? text("analytics.charts.detail-estimated", {
					amount: format.formatMetric(value.estimated, metricUnit(units, metric)),
				})
			: undefined;
	const missing =
		value.missing !== null && value.missing > 0
			? text("analytics.summary.missing-amount", {
					amount: format.formatMetric(value.missing, units.entryUnit),
				})
			: undefined;
	if (estimated !== undefined && missing !== undefined) {
		return text("analytics.charts.detail-both", { missing, estimated });
	}
	return estimated ?? missing;
};

export function MediaAnalyticsCharts(props: SummaryChartsProps) {
	const { compact } = useRyotViewport();
	const text = useMediaMessages();
	const [metric, setMetric] = useState<MediaAnalyticsMetric>("activeObservations");
	const [selectedType, setSelectedType] = useState("all");
	const t = useT();
	const types = props.summary.current.types;
	const selectedRow = types.find((row) => row.mediaType === selectedType);
	const mediaType = selectedRow?.mediaType;
	const drillType = useMemo(
		() =>
			selectedRow === undefined
				? undefined
				: { slug: selectedRow.mediaType, label: t(selectedRow.label) },
		[selectedRow, t],
	);
	useValueChange(JSON.stringify(props.input), () => setSelectedType("all"));
	const input = useMemo(
		(): ChartInput => ({ ...props.input, ...(mediaType === undefined ? {} : { mediaType }) }),
		[mediaType, props.input],
	);
	const trendResult = useRyotQuery(mediaAnalyticsTrendQuery, input);
	const hoursResult = useRyotQuery(mediaAnalyticsHoursQuery, input);
	const consistencyResult = useRyotQuery(mediaAnalyticsConsistencyQuery, props.input);

	return (
		<section
			className="flex min-w-0 flex-col gap-4 font-ui"
			aria-label={text("analytics.charts.aria-label")}
		>
			<TrendRegion
				types={types}
				metric={metric}
				compact={compact}
				input={props.input}
				result={trendResult}
				mediaType={drillType}
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
					mediaType={drillType}
					onDrill={props.onDrill}
				/>
				<ConsistencyRegion compact={compact} onDrill={props.onDrill} result={consistencyResult} />
			</div>
		</section>
	);
}

const trendPoints = (
	text: MediaText,
	units: AnalyticsUnits,
	format: MetricFormat,
	buckets: ReadonlyArray<TrendBucket>,
	metric: MediaAnalyticsMetric,
) =>
	buckets.map((bucket) => ({
		at: bucket.date,
		value: bucket.value,
		period: bucket.period,
		detail: metricDetail(text, units, format, metric, bucket),
	}));

function ConsistencyRegion(props: {
	readonly compact: boolean;
	readonly onDrill: SummaryChartsProps["onDrill"];
	readonly result: RyotQueryResult<Reported<MediaAnalyticsTrend> & { readonly clipped: boolean }>;
}) {
	const periodCaption = usePeriodCaption();
	const text = useMediaMessages();
	const { entryUnit } = useAnalyticsUnits();
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
				selection: selectionForPeriod(data.reporting.selection, day.period),
				title: text("analytics.charts.title-with-period", {
					period: periodCaption(day.period),
					label: text("analytics.metric.activity-entries"),
				}),
			});
		},
		[data, onDrill, periodCaption, text],
	);
	const consistencyDescription = () => {
		if (data === undefined) {
			return text("analytics.charts.all-media-types");
		}
		const period = periodCaption(data.current.period);
		return data.clipped
			? text("analytics.charts.consistency-clipped", { period, count: REPORTING_BUCKET_LIMIT })
			: text("analytics.charts.consistency-period", { period });
	};
	return (
		<ChartCard
			description={consistencyDescription()}
			title={text("analytics.charts.consistency-title")}
		>
			<QueryStatus query={props.result} onRetry={props.result.refetch}>
				{(loaded) => (
					<CalendarHeatmap
						unit={entryUnit}
						onSelect={openDay}
						compact={props.compact}
						weekStart={loaded.reporting.resolved.weekStart}
						days={consistencyModel(loaded, loaded.reporting.resolved)}
						ariaLabel={text("analytics.charts.consistency-aria-label", {
							period: periodCaption(loaded.current.period),
						})}
					/>
				)}
			</QueryStatus>
		</ChartCard>
	);
}

function HourlyRegion(props: {
	readonly compact: boolean;
	readonly metric: MediaAnalyticsMetric;
	readonly input: SummaryChartsProps["input"];
	readonly onDrill: SummaryChartsProps["onDrill"];
	readonly mediaType: undefined | AnalyticsDrillMediaType;
	readonly result: RyotQueryResult<Reported<{ readonly hours: MediaAnalyticsHours }>>;
}) {
	const periodCaption = usePeriodCaption();
	const text = useMediaMessages();
	const units = useAnalyticsUnits();
	const format = useMetricFormat();
	const formatters = useFormatters();
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
				title: text("analytics.charts.hour-title", {
					metric: metricLabel(text, metric),
					hour: analyticsHourLabel(formatters, bucket.hour),
				}),
				...metricFilter(metric, mediaType),
			});
		},
		[data, formatters, metric, mediaType, onDrill, periodCaption, text],
	);
	return (
		<ChartCard
			title={text("analytics.charts.hourly-title")}
			description={
				data === undefined
					? text("analytics.charts.hourly-description", { metric: metricLabel(text, metric) })
					: text("analytics.charts.hourly-description-zone", {
							metric: metricLabel(text, metric),
							timeZone: data.reporting.resolved.timeZone,
						})
			}
		>
			<QueryStatus query={props.result} onRetry={props.result.refetch}>
				{(loaded) => (
					<HourlyHistogram
						onSelect={openHour}
						compact={props.compact}
						unit={metricUnit(units, metric)}
						view={{ value: view, onChange: setView }}
						timeZone={loaded.reporting.resolved.timeZone}
						ariaLabel={text("analytics.charts.hourly-aria-label", {
							metric: metricLabel(text, metric),
						})}
						buckets={hourlyModel(loaded.hours, metric).map((row) => ({
							hour: row.hour,
							value: row.value,
							detail: metricDetail(text, units, format, metric, row),
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
	readonly input: SummaryChartsProps["input"];
	readonly onDrill: SummaryChartsProps["onDrill"];
	readonly onTypeChange: (mediaType: string) => void;
	readonly mediaType: undefined | AnalyticsDrillMediaType;
	readonly result: RyotQueryResult<Reported<MediaAnalyticsTrend>>;
	readonly onMetricChange: (metric: MediaAnalyticsMetric) => void;
	readonly types: SummaryChartsProps["summary"]["current"]["types"];
}) {
	const periodCaption = usePeriodCaption();
	const text = useMediaMessages();
	const units = useAnalyticsUnits();
	const format = useMetricFormat();
	const data = props.result.data;
	const t = useT();
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
				selection: selectionForPeriod(data.reporting.selection, bucket.period),
				title: text("analytics.charts.title-with-period", {
					period: caption,
					label: metricLabel(text, metric),
				}),
				...metricFilter(metric, mediaType),
			});
		},
		[data, metric, mediaType, onDrill, periodCaption, text],
	);
	const points = (series: MediaAnalyticsTrend["current"], trend: Reported<MediaAnalyticsTrend>) =>
		trendPoints(
			text,
			units,
			format,
			trendBuckets(trend, series, metric, trend.reporting.resolved),
			metric,
		);
	return (
		<ChartCard
			title={text("analytics.charts.trend-title")}
			actions={
				<>
					<Select
						variant="compact"
						value={props.metric}
						onChange={props.onMetricChange}
						label={text("analytics.charts.metric-select")}
						checkIcon={<AppIcon size={14} name="check" />}
						chevronIcon={<AppIcon size={14} name="chevron-down" />}
						choices={analyticsMetrics.map((value) => ({ value, label: metricLabel(text, value) }))}
					/>
					<Select
						variant="compact"
						value={props.selectedType}
						onChange={props.onTypeChange}
						label={text("property.type")}
						checkIcon={<AppIcon size={14} name="check" />}
						chevronIcon={<AppIcon size={14} name="chevron-down" />}
						choices={[
							{ value: "all", label: text("analytics.charts.all-types") },
							...props.types.map((row) => ({ label: t(row.label), value: row.mediaType })),
						]}
					/>
				</>
			}
		>
			<QueryStatus query={props.result} onRetry={props.result.refetch}>
				{(loaded) => (
					<PeriodTrendChart
						onSelect={openPeriod}
						compact={props.compact}
						grouping={loaded.grouping}
						unit={metricUnit(units, metric)}
						current={points(loaded.current, loaded)}
						view={{ value: view, onChange: setView }}
						label={periodCaption(loaded.current.period)}
						timeZone={loaded.reporting.resolved.timeZone}
						ariaLabel={text("analytics.charts.trend-aria-label", {
							metric: metricLabel(text, metric),
						})}
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
