import {
	addCalendarDays,
	type AnalyticsSectionProps,
	calendarBuckets,
	localDateOf,
	type Reported,
	REPORTING_BUCKET_LIMIT,
	type ReportingSelection,
	resolveReportingSelection,
	type TimeZone,
} from "@ryot-app/plugin-client-sdk/plugin";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";

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

export type SummaryChartsProps = RankingsRecordsProps;
export type AnalyticsInput = Omit<MediaAnalyticsInput, "now">;
export type MediaAnalyticsRecord = MediaAnalyticsRecords["items"][number];
export type MediaAnalyticsProcessing = MediaAnalyticsSummary["processing"];
export type MediaAnalyticsTrend = Recipe.Success<typeof mediaAnalyticsTrendRecipe>;
export type MediaAnalyticsHours = Recipe.Success<typeof mediaAnalyticsHoursRecipe>;
export type MediaAnalyticsRanking = Recipe.Success<typeof mediaAnalyticsRankingRecipe>;
export type MediaAnalyticsRecords = Recipe.Success<typeof mediaAnalyticsRecordsRecipe>;
export type MediaAnalyticsSummary = Recipe.Success<typeof mediaAnalyticsSummaryRecipe>;
export type MediaAnalyticsMetric =
	"titleCompletions" | "episodeCompletions" | "activeObservations" | ConsumptionMeasureUnit;
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

export const analyticsInput = ({
	owner,
	timeZone,
	selection,
}: AnalyticsSectionProps): AnalyticsInput => ({ timeZone, selection, reference: owner });

/** The daily heatmap shows at most one bucket-limit of days ending at the period end or today. */
export const consistencySelection = (input: AnalyticsInput, now: number) => {
	const current = resolveReportingSelection(input.selection, {
		now,
		timeZone: input.timeZone,
	}).current;
	const endDate = current?.endDate ?? localDateOf(now, input.timeZone);
	const earliest = addCalendarDays(endDate, 1 - REPORTING_BUCKET_LIMIT);
	const startDate = current === null || current.startDate < earliest ? earliest : current.startDate;
	return {
		clipped: current === null || current.startDate < startDate,
		selection: {
			grouping: "day",
			comparison: "none",
			range: { endDate, startDate, kind: "custom" },
		} satisfies ReportingSelection,
	};
};

type TypeRow = MediaAnalyticsSummary["current"]["types"][number];
type MeasureRow = Omit<MediaAnalyticsTrend["current"]["items"][number], "at">;

const total = <Row>(rows: readonly Row[], value: (row: Row) => null | number | undefined) =>
	rows.reduce((sum, row) => sum + (value(row) ?? 0), 0);

export const quantityValue = (
	rows: readonly MeasureRow[],
	unit: ConsumptionMeasureUnit,
	ready = true,
) => {
	const known = total(rows, (row) => row[`${unit}Known`]);
	const missing = total(rows, (row) => row[`${unit}Missing`]);
	const recorded = total(rows, (row) => row[`${unit}Recorded`]);
	const estimated = total(rows, (row) => row[`${unit}Estimated`]);
	return {
		known: ready ? known : null,
		partial: !ready || missing > 0,
		missing: ready ? missing : null,
		recorded: ready ? recorded : null,
		estimated: ready ? estimated : null,
		value: ready && known > 0 ? recorded + estimated : null,
		superseded: ready ? total(rows, (row) => row[`${unit}Superseded`]) : null,
	};
};

const quantities = (rows: readonly MeasureRow[], ready: boolean) => ({
	pages: quantityValue(rows, "pages", ready),
	minutes: quantityValue(rows, "minutes", ready),
	volumes: quantityValue(rows, "volumes", ready),
	episodes: quantityValue(rows, "episodes", ready),
	chapters: quantityValue(rows, "chapters", ready),
});

const counts = (rows: readonly TypeRow[], ready: boolean) => {
	const count = (value: (row: TypeRow) => null | number | undefined) =>
		ready ? total(rows, value) : null;
	return {
		distinctTitles: count((row) => row.distinctTitles),
		titleCompletions: count((row) => row.titleCompletions),
		episodeCompletions: count((row) => row.episodeCompletions),
		activeObservations: count((row) => row.activeObservations),
	};
};

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
	const ready = summary.processing === "ready";
	const period = (data: NonNullable<MediaAnalyticsSummary["previous"]>) => ({
		...counts(data.types, ready),
		reviews: reviewModel(data.reviews),
		quantities: quantities(data.types, ready),
		activeDays: ready ? data.activeDays : null,
		types: data.types.map((row) => ({
			source: row,
			...counts([row], ready),
			quantities: quantities([row], ready),
			activeDays: ready ? row.activeDays : null,
		})),
	});
	return {
		processing: summary.processing,
		current: period(summary.current),
		unknownDate: ready ? summary.unknownDate : null,
		previous: summary.previous === null ? null : period(summary.previous),
	};
};

const chartValue = (
	rows: readonly MeasureRow[],
	metric: MediaAnalyticsMetric,
	processing: MediaAnalyticsProcessing,
) => {
	if (processing !== "ready") {
		return {
			value: null,
			known: null,
			missing: null,
			recorded: null,
			estimated: null,
			lowerBound: false,
		};
	}
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
	return { known, value, missing, recorded, estimated, lowerBound: (missing ?? 0) > 0 };
};

export type TrendBucket = ReturnType<typeof trendBuckets>[number];
export const trendBuckets = (
	trend: MediaAnalyticsTrend,
	series: MediaAnalyticsTrend["current"],
	metric: MediaAnalyticsMetric,
	processing: MediaAnalyticsProcessing,
	timeZone: TimeZone,
) =>
	calendarBuckets(series.items, {
		timeZone,
		at: (row) => row.at,
		period: series.period,
		grouping: trend.grouping,
	}).map((bucket) =>
		Object.assign(
			{ date: bucket.date, period: bucket.period },
			chartValue(bucket.points, metric, processing),
		),
	);

export const hourlyModel = (
	hours: MediaAnalyticsHours,
	metric: MediaAnalyticsMetric,
	processing: MediaAnalyticsProcessing,
) =>
	Array.from({ length: 24 }, (_, hour) => ({
		hour,
		...chartValue(
			hours.filter((row) => row.hour === hour),
			metric,
			processing,
		),
	}));

export const consistencyModel = (
	trend: MediaAnalyticsTrend,
	processing: MediaAnalyticsProcessing,
	timeZone: TimeZone,
) =>
	trendBuckets(trend, trend.current, "activeObservations", processing, timeZone).map(
		({ date, value, period }) => ({ date, value, period }),
	);

export const rankingModel = (
	rows: MediaAnalyticsRanking["items"],
	processing: MediaAnalyticsProcessing,
) =>
	rows.map((row) => ({
		...row,
		titleCompletions: processing === "ready" ? row.titleCompletions : null,
		activeObservations: processing === "ready" ? row.activeObservations : null,
		episodeCompletions: processing === "ready" ? row.episodeCompletions : null,
	}));

export const recordModel = (row: MediaAnalyticsRecord, processing: MediaAnalyticsProcessing) => ({
	source: row,
	manualMinutes: row.facts.timeSpent ?? null,
	contribution: processing === "ready" ? row.contribution : null,
	date:
		row.contribution.attribution.kind === "unknown"
			? "Unknown date"
			: row.contribution.attribution.value,
	item:
		row.facts.consumedItem === undefined
			? null
			: `${row.facts.consumedItem.unit} position ${row.facts.consumedItem.position}${row.facts.consumedItem.volume === undefined ? "" : `, volume ${row.facts.consumedItem.volume}`}`,
	sourceProgress:
		row.facts.sourceProgress === undefined
			? null
			: `Original source evidence: ${row.facts.sourceProgress.unit} position ${row.facts.sourceProgress.position}, ${row.facts.sourceProgress.percent}% (not an allocated amount)`,
});
