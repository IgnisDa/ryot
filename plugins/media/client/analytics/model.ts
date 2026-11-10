import {
	calendarBuckets,
	type Reported,
	type ReportingSelection,
	type TimeZone,
} from "@ryot-app/plugin-client-sdk/plugin";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";
import { countUnit, durationUnit, type MetricUnit } from "@ryot-app/plugin-ui-sdk";

import type {
	MediaAnalyticsFilter,
	mediaAnalyticsHoursRecipe,
	MediaAnalyticsInput,
	mediaAnalyticsRankingRecipe,
	mediaAnalyticsRecordsRecipe,
	mediaAnalyticsSummaryRecipe,
	mediaAnalyticsTrendRecipe,
} from "../../shared/analytics-recipes";
import type { ConsumptionMeasureUnit } from "../../shared/consumption-allocation";
import { mediaPositionLabel } from "../media/activity-copy";

export type SummaryChartsProps = RankingsRecordsProps;
export type MediaAnalyticsRecord = MediaAnalyticsRecords["items"][number];
export type MediaAnalyticsProcessing = MediaAnalyticsSummary["processing"];
export type MediaAnalyticsTrend = Recipe.Success<typeof mediaAnalyticsTrendRecipe>;
export type MediaAnalyticsHours = Recipe.Success<typeof mediaAnalyticsHoursRecipe>;
export type MediaAnalyticsRanking = Recipe.Success<typeof mediaAnalyticsRankingRecipe>;
export type MediaAnalyticsRecords = Recipe.Success<typeof mediaAnalyticsRecordsRecipe>;
export type MediaAnalyticsSummary = Recipe.Success<typeof mediaAnalyticsSummaryRecipe>;
export type MediaAnalyticsMetric =
	"titleCompletions" | "episodeCompletions" | "activeObservations" | ConsumptionMeasureUnit;
export type AnalyticsInput = Omit<MediaAnalyticsInput, "reporting"> & {
	readonly timeZone: TimeZone;
	readonly selection: ReportingSelection;
};
export type RankingsRecordsProps = {
	readonly input: AnalyticsInput;
	readonly summary: Reported<MediaAnalyticsSummary>;
	readonly onDrill: (request: RecordsDrillRequest) => void;
};
export type RecordsDrillRequest = MediaAnalyticsFilter & {
	readonly title: string;
	readonly entityId?: string;
	readonly periodCaption: string;
	readonly selection: ReportingSelection;
};

type TypeRow = MediaAnalyticsSummary["current"]["types"][number];

export const titleUnit = countUnit("title");
export const episodeUnit = countUnit("episode");
export const dayUnit = countUnit("day");
export const entryUnit = countUnit("entry", "entries");
export const uniqueTitleUnit = countUnit("unique title");

export const measureUnits: Record<ConsumptionMeasureUnit, MetricUnit> = {
	pages: countUnit("page"),
	volumes: countUnit("volume"),
	chapters: countUnit("chapter"),
	episodes: countUnit("episode"),
	minutes: durationUnit("minutes"),
};

export const measureLabels: Record<ConsumptionMeasureUnit, string> = {
	pages: "Pages",
	volumes: "Volumes",
	chapters: "Chapters",
	episodes: "Episodes",
	minutes: "Time spent",
};
type MeasureRow = Omit<MediaAnalyticsTrend["current"]["items"][number], "at">;

const total = <Row>(rows: readonly Row[], value: (row: Row) => null | number | undefined) =>
	rows.reduce((sum, row) => sum + (value(row) ?? 0), 0);

export const quantityValue = (rows: readonly MeasureRow[], unit: ConsumptionMeasureUnit) => {
	const known = total(rows, (row) => row[`${unit}Known`]);
	const missing = total(rows, (row) => row[`${unit}Missing`]);
	const recorded = total(rows, (row) => row[`${unit}Recorded`]);
	const estimated = total(rows, (row) => row[`${unit}Estimated`]);
	return {
		known,
		missing,
		recorded,
		estimated,
		partial: missing > 0,
		value: known > 0 ? recorded + estimated : null,
		superseded: total(rows, (row) => row[`${unit}Superseded`]),
	};
};

const quantities = (rows: readonly MeasureRow[]) => ({
	pages: quantityValue(rows, "pages"),
	minutes: quantityValue(rows, "minutes"),
	volumes: quantityValue(rows, "volumes"),
	episodes: quantityValue(rows, "episodes"),
	chapters: quantityValue(rows, "chapters"),
});

const counts = (rows: readonly TypeRow[]) => ({
	distinctTitles: total(rows, (row) => row.distinctTitles),
	titleCompletions: total(rows, (row) => row.titleCompletions),
	episodeCompletions: total(rows, (row) => row.episodeCompletions),
	activeObservations: total(rows, (row) => row.activeObservations),
});

export const reviewModel = (reviews: MediaAnalyticsSummary["current"]["reviews"]) => {
	const rated = total(reviews, (row) => row.rated);
	return {
		rated,
		categories: reviews,
		reviews: total(reviews, (row) => row.reviews),
		averageRating:
			rated === 0
				? null
				: total(reviews, (row) => (row.averageRating ?? 0) * (row.rated ?? 0)) / rated,
	};
};

export const summaryModel = (summary: MediaAnalyticsSummary) => {
	const period = (data: NonNullable<MediaAnalyticsSummary["previous"]>) => ({
		...counts(data.types),
		activeDays: data.activeDays,
		reviews: reviewModel(data.reviews),
		quantities: quantities(data.types),
		types: data.types.map((row) => ({
			source: row,
			...counts([row]),
			activeDays: row.activeDays,
			quantities: quantities([row]),
		})),
	});
	return {
		current: period(summary.current),
		unknownDate: summary.unknownDate,
		previous: summary.previous === null ? null : period(summary.previous),
	};
};

const chartValue = (rows: readonly MeasureRow[], metric: MediaAnalyticsMetric) => {
	if (
		metric === "titleCompletions" ||
		metric === "episodeCompletions" ||
		metric === "activeObservations"
	) {
		return {
			known: null,
			missing: null,
			recorded: null,
			estimated: null,
			lowerBound: false,
			value: total(rows, (row) => row[metric]),
		};
	}
	const { known, value, missing, recorded, estimated } = quantityValue(rows, metric);
	return { known, value, missing, recorded, estimated, lowerBound: missing > 0 };
};

export type TrendBucket = ReturnType<typeof trendBuckets>[number];
export const trendBuckets = (
	trend: MediaAnalyticsTrend,
	series: MediaAnalyticsTrend["current"],
	metric: MediaAnalyticsMetric,
	timeZone: TimeZone,
) =>
	calendarBuckets(series.items, {
		timeZone,
		at: (row) => row.at,
		period: series.period,
		grouping: trend.grouping,
	}).map((bucket) =>
		Object.assign({ date: bucket.date, period: bucket.period }, chartValue(bucket.points, metric)),
	);

export const hourlyModel = (hours: MediaAnalyticsHours, metric: MediaAnalyticsMetric) =>
	Array.from({ length: 24 }, (_, hour) => ({
		hour,
		...chartValue(
			hours.filter((row) => row.hour === hour),
			metric,
		),
	}));

export const consistencyModel = (trend: MediaAnalyticsTrend, timeZone: TimeZone) =>
	trendBuckets(trend, trend.current, "activeObservations", timeZone).map(
		({ date, value, period }) => ({ date, value, period }),
	);

export const recordModel = (row: MediaAnalyticsRecord) => ({
	source: row,
	manualMinutes: row.facts.timeSpent ?? null,
	position: row.facts.position === undefined ? null : mediaPositionLabel(row.facts.position),
	date:
		row.contribution.attribution.kind === "unknown"
			? "Unknown date"
			: row.contribution.attribution.value,
	sourceProgress:
		row.facts.sourceProgress === undefined
			? null
			: `Original source progress: ${mediaPositionLabel(row.facts.sourceProgress)}, ${row.facts.sourceProgress.percent}% (not an allocated amount)`,
});
