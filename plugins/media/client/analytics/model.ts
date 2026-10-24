import {
	addCalendarDays,
	addCalendarUnits,
	type AnalyticsSectionProps,
	calendarDaysBetween,
	calendarPeriod,
	localDateOf,
	type ReportingSelection,
	resolveReportingSelection,
	startOfCalendarUnit,
	type TimeZone,
} from "@ryot-app/plugin-client-sdk/plugin";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";

import {
	type MediaAnalyticsCalendarInput,
	type mediaAnalyticsConsistencyRecipe,
	type MediaAnalyticsFilter,
	type mediaAnalyticsHoursRecipe,
	type MediaAnalyticsInput,
	mediaAnalyticsPeriods,
	type mediaAnalyticsRankingRecipe,
	type mediaAnalyticsRecordsRecipe,
	type mediaAnalyticsStatsRecipe,
	type mediaAnalyticsTrendRecipe,
	resolveMediaAnalyticsPeriods,
} from "../../shared/analytics-recipes";
import type { ConsumptionMeasureUnit } from "../../shared/consumption-allocation";
import type { mediaConsumptionReportRecipe } from "../../shared/consumption-recipes";

export type AnalyticsInput = Omit<MediaAnalyticsInput, "now">;
export type MediaAnalyticsSectionInput = AnalyticsSectionProps;
export type ReportingGrouping = ReportingResolution["grouping"];
export type MediaAnalyticsRecord = MediaAnalyticsRecords["items"][number];
export type ReportingPeriod = NonNullable<ReportingResolution["current"]>;
export type ReportingResolution = ReturnType<typeof resolveReportingSelection>;
export type Reported<Data> = Data & { readonly reporting: ReportingExecution };
export type MediaAnalyticsStats = Recipe.Success<typeof mediaAnalyticsStatsRecipe>;
export type MediaAnalyticsTrend = Recipe.Success<typeof mediaAnalyticsTrendRecipe>;
export type MediaAnalyticsHours = Recipe.Success<typeof mediaAnalyticsHoursRecipe>;
export type MediaAnalyticsRanking = Recipe.Success<typeof mediaAnalyticsRankingRecipe>;
export type MediaAnalyticsRecords = Recipe.Success<typeof mediaAnalyticsRecordsRecipe>;
export type MediaConsumptionReport = Recipe.Success<typeof mediaConsumptionReportRecipe>;
export type AnalyticsWindowInput = AnalyticsCalendarInput & { readonly anchorDate: string };
export type MediaAnalyticsConsistency = Recipe.Success<typeof mediaAnalyticsConsistencyRecipe>;
export type AnalyticsCalendarInput = AnalyticsInput & Omit<MediaAnalyticsCalendarInput, "now">;
export type MediaAnalyticsMetric =
	"titleCompletions" | "episodeCompletions" | "activeObservations" | ConsumptionMeasureUnit;
export type RankingsRecordsProps = {
	readonly input: AnalyticsInput;
	readonly report: Reported<MediaConsumptionReport>;
	readonly onDrill: (request: RecordsDrillRequest) => void;
};
export type RecordsDrillRequest = MediaAnalyticsFilter & {
	readonly title: string;
	readonly entityId?: string;
	readonly periodCaption: string;
	readonly selection: ReportingSelection;
};
export type ReportingExecution = {
	readonly now: number;
	readonly anchorDate: string;
	readonly resolved: ReportingResolution;
	readonly selection: ReportingSelection;
	readonly originalSelection: ReportingSelection;
};
export type SummaryChartsProps = {
	readonly input: AnalyticsInput;
	readonly stats?: Reported<MediaAnalyticsStats>;
	readonly report: Reported<MediaConsumptionReport>;
	readonly onDrill: (request: RecordsDrillRequest) => void;
};

export const analyticsInput = ({
	owner,
	timeZone,
	selection,
}: AnalyticsSectionProps): AnalyticsInput => ({ timeZone, selection, reference: owner });
export const selectionForPeriod = (
	selection: ReportingSelection,
	period: null | ReportingPeriod,
): ReportingSelection => ({
	comparison: "none",
	grouping: selection.grouping,
	range:
		period === null
			? { kind: "all-time" }
			: { kind: "custom", endDate: period.endDate, startDate: period.startDate },
});
export const reportingExecution = (input: AnalyticsInput, now: number): ReportingExecution => {
	const resolved = resolveReportingSelection(input.selection, { now, timeZone: input.timeZone });
	return {
		now,
		resolved,
		originalSelection: input.selection,
		anchorDate: resolved.current?.endDate ?? localDateOf(now, input.timeZone),
		selection: selectionForPeriod(
			{ ...input.selection, grouping: resolved.grouping },
			resolved.current,
		),
	};
};
export const analyticsCalendarInput = (
	input: AnalyticsInput,
	reporting: ReportingExecution,
): AnalyticsCalendarInput => ({
	timeZone: input.timeZone,
	reference: input.reference,
	selection: input.selection,
	...(input.entityId === undefined ? {} : { entityId: input.entityId }),
	periods: mediaAnalyticsPeriods(reporting.resolved),
});
export const analyticsWindowInput = (
	input: AnalyticsInput,
	reporting: ReportingExecution,
): AnalyticsWindowInput => ({
	...analyticsCalendarInput(input, reporting),
	anchorDate: reporting.anchorDate,
});
export const calendarReportingExecution = (
	input: AnalyticsCalendarInput,
	now: number,
	anchorDate?: string,
): ReportingExecution => {
	const resolved = resolveMediaAnalyticsPeriods({ ...input, now });
	return {
		now,
		resolved,
		originalSelection: input.selection,
		anchorDate: anchorDate ?? resolved.current?.endDate ?? localDateOf(now, input.timeZone),
		selection: selectionForPeriod(
			{ ...input.selection, grouping: resolved.grouping },
			resolved.current,
		),
	};
};
export const periodCaption = (period: null | ReportingPeriod) => {
	if (period === null) {
		return "All time";
	}
	return period.startDate === period.endDate
		? period.startDate
		: `${period.startDate} – ${period.endDate}`;
};
export const comparisonCaption = (reporting: ReportingExecution) =>
	reporting.resolved.previous === null
		? null
		: `${periodCaption(reporting.resolved.current)} vs ${periodCaption(reporting.resolved.previous)}`;
export const formatExactValue = (value: null | number, unit = "") =>
	value === null || !Number.isFinite(value)
		? "Unknown"
		: `${Object.is(value, -0) ? "0" : String(value)}${unit === "" ? "" : ` ${unit}`}`;
export const compareValues = (current: null | number, previous: null | number, partial = false) => {
	if (
		partial ||
		current === null ||
		previous === null ||
		!Number.isFinite(current) ||
		!Number.isFinite(previous)
	) {
		return { percent: null, absolute: null, kind: "unknown" as const };
	}
	let percent: null | number = null;
	if (previous !== 0) {
		percent = ((current - previous) / Math.abs(previous)) * 100;
	} else if (current === 0) {
		percent = 0;
	}
	return {
		percent,
		absolute: current - previous,
		kind: previous === 0 && current > 0 ? ("new-activity" as const) : ("change" as const),
	};
};

export const mediaTypeLabel = (slug: string) => {
	switch (slug) {
		case "group":
			return "Groups";
		case "person":
			return "People";
		case "company":
			return "Companies";
		case "book-group":
			return "Book groups";
		case "comic-book":
			return "Comic books";
		case "video-game":
			return "Video games";
		case "movie-group":
			return "Movie groups";
		case "music-group":
			return "Music groups";
		case "show-season":
			return "Show seasons";
		case "show-episode":
			return "Show episodes";
		case "visual-novel":
			return "Visual novels";
		case "audiobook-group":
			return "Audiobook groups";
		case "podcast-episode":
			return "Podcast episodes";
		case "comic-book-group":
			return "Comic book groups";
		case "video-game-group":
			return "Video game groups";
		default:
			return slug.charAt(0).toUpperCase() + slug.slice(1);
	}
};
export const reviewTargetKind = (slug: string) => {
	if (slug === "person" || slug === "company") {
		return "creator" as const;
	}
	if (slug.endsWith("-group")) {
		return "group" as const;
	}
	return slug.endsWith("-episode") || slug.endsWith("-season")
		? ("child" as const)
		: ("title" as const);
};
export const displayMediaType = (slug: string) => {
	if (slug === "show-episode") {
		return "show";
	}
	return slug === "podcast-episode" ? "podcast" : slug;
};

const bucketDistance = (from: string, until: string, grouping: ReportingGrouping) => {
	if (grouping === "year") {
		return Number(until.slice(0, 4)) - Number(from.slice(0, 4));
	}
	if (grouping === "month") {
		return (
			(Number(until.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
			Number(until.slice(5, 7)) -
			Number(from.slice(5, 7))
		);
	}
	return Math.round(calendarDaysBetween(from, until) / (grouping === "week" ? 7 : 1));
};
export type AnalyticsWindow = {
	readonly period: ReportingPeriod;
	readonly nextCursor: null | string;
	readonly grouping: ReportingGrouping;
	readonly previousCursor: null | string;
};
export const analyticsWindow = (
	reporting: ReportingExecution,
	kind: "trend" | "daily",
	endCursor?: string,
): AnalyticsWindow => {
	const grouping = kind === "daily" ? "day" : reporting.resolved.grouping;
	const limit = kind === "daily" ? 400 : 32;
	const range = reporting.resolved.current;
	const last = range?.endDate ?? reporting.anchorDate;
	const cursor = endCursor === undefined || endCursor > last ? last : endCursor;
	const endDate = range !== null && cursor < range.startDate ? range.startDate : cursor;
	const first = addCalendarUnits(startOfCalendarUnit(endDate, grouping), grouping, -(limit - 1));
	const startDate = range !== null && range.startDate > first ? range.startDate : first;
	const nextEnd = addCalendarDays(
		addCalendarUnits(startOfCalendarUnit(endDate, grouping), grouping, limit + 1),
		-1,
	);
	const nextCursor = nextEnd > last ? last : nextEnd;
	return {
		grouping,
		nextCursor: endDate >= last ? null : nextCursor,
		period: calendarPeriod(startDate, endDate, reporting.resolved.timeZone),
		previousCursor:
			range !== null && startDate <= range.startDate ? null : addCalendarDays(startDate, -1),
	};
};
export const comparisonWindow = (
	reporting: ReportingExecution,
	window: AnalyticsWindow,
): null | ReportingPeriod => {
	const current = reporting.resolved.current;
	const previous = reporting.resolved.previous;
	if (current === null || previous === null) {
		return null;
	}
	const grouping = window.grouping;
	const offset = bucketDistance(
		startOfCalendarUnit(current.startDate, grouping),
		startOfCalendarUnit(window.period.startDate, grouping),
		grouping,
	);
	const start = addCalendarUnits(
		startOfCalendarUnit(previous.startDate, grouping),
		grouping,
		offset,
	);
	if (start > previous.endDate) {
		return null;
	}
	const count =
		bucketDistance(
			startOfCalendarUnit(window.period.startDate, grouping),
			startOfCalendarUnit(window.period.endDate, grouping),
			grouping,
		) + 1;
	const bound = addCalendarDays(addCalendarUnits(start, grouping, 32), -1);
	const alignedEnd =
		window.period.endDate === current.endDate
			? previous.endDate
			: addCalendarDays(addCalendarUnits(start, grouping, count), -1);
	const end = alignedEnd > bound ? bound : alignedEnd;
	return calendarPeriod(
		start < previous.startDate ? previous.startDate : start,
		end > previous.endDate ? previous.endDate : end,
		reporting.resolved.timeZone,
	);
};
export const extraPreviousWindow = (
	reporting: ReportingExecution,
	window: AnalyticsWindow,
	previousWindow: null | ReportingPeriod,
): null | ReportingPeriod => {
	const previous = reporting.resolved.previous;
	if (
		previousWindow === null ||
		previous === null ||
		window.period.endDate !== reporting.resolved.current.endDate ||
		previousWindow.endDate >= previous.endDate
	) {
		return null;
	}
	return calendarPeriod(
		addCalendarDays(previousWindow.endDate, 1),
		previous.endDate,
		reporting.resolved.timeZone,
	);
};

type QuantityRow = MediaAnalyticsTrend["items"][number];
type QuantityPresence = MediaAnalyticsStats["current"]["global"];
type QuantityTotals = MediaConsumptionReport["current"]["items"][number];
type QuantityMeasures = Omit<QuantityRow, "at" | "precision" | "mediaType">;
export const quantityValue = (
	source: QuantityTotals | QuantityMeasures,
	presence: QuantityMeasures | QuantityPresence,
	unit: ConsumptionMeasureUnit,
	ready = true,
) => {
	const recorded = source[`${unit}Recorded`] ?? 0;
	const estimated = source[`${unit}Estimated`] ?? 0;
	const missing = source[`${unit}Missing`] ?? 0;
	const known = presence[`${unit}Known`] ?? 0;
	return {
		known: ready ? known : null,
		partial: !ready || missing > 0,
		missing: ready ? missing : null,
		recorded: ready ? recorded : null,
		estimated: ready ? estimated : null,
		value: ready && known > 0 ? recorded + estimated : null,
		superseded: ready ? (presence[`${unit}Superseded`] ?? 0) : null,
	};
};

export const summaryModel = (
	report: MediaConsumptionReport,
	stats: undefined | MediaAnalyticsStats,
) => {
	const ready = report.processing === "ready";
	const period = (
		totals: MediaConsumptionReport["current"],
		supplemental: undefined | MediaAnalyticsStats["current"],
	) => {
		const partial = totals.pageInfo.hasMore || (supplemental?.types.pageInfo?.hasMore ?? false);
		const quantity = (unit: ConsumptionMeasureUnit) => {
			const recorded = totals.items.reduce(
				(total, row) => total + (row[`${unit}Recorded`] ?? 0),
				0,
			);
			const estimated = totals.items.reduce(
				(total, row) => total + (row[`${unit}Estimated`] ?? 0),
				0,
			);
			const missing = totals.items.reduce((total, row) => total + (row[`${unit}Missing`] ?? 0), 0);
			const known = supplemental?.global[`${unit}Known`] ?? null;
			return {
				known: ready ? known : null,
				missing: ready ? missing : null,
				recorded: ready ? recorded : null,
				estimated: ready ? estimated : null,
				partial: !ready || partial || missing > 0,
				value: ready && known !== null && known > 0 ? recorded + estimated : null,
			};
		};
		return {
			partial,
			activeDays: ready ? (supplemental?.global.activeDays ?? null) : null,
			distinctTitles: ready ? (supplemental?.global.distinctTitles ?? null) : null,
			unknownDate: ready
				? totals.items.reduce((total, row) => total + (row.unknownDate ?? 0), 0)
				: null,
			titleCompletions: ready
				? totals.items.reduce((total, row) => total + (row.titleCompletions ?? 0), 0)
				: null,
			episodeCompletions: ready
				? totals.items.reduce((total, row) => total + (row.episodeCompletions ?? 0), 0)
				: null,
			activeObservations: ready
				? totals.items.reduce((total, row) => total + (row.activeObservations ?? 0), 0)
				: null,
			quantities: {
				pages: quantity("pages"),
				minutes: quantity("minutes"),
				volumes: quantity("volumes"),
				episodes: quantity("episodes"),
				chapters: quantity("chapters"),
			},
			types: totals.items.map((row) => {
				const presence = supplemental?.types.items.find((item) => item.mediaType === row.mediaType);
				return {
					source: row,
					label: mediaTypeLabel(row.mediaType),
					unknownDate: ready ? (row.unknownDate ?? 0) : null,
					activeDays: ready ? (presence?.activeDays ?? null) : null,
					titleCompletions: ready ? (row.titleCompletions ?? 0) : null,
					episodeCompletions: ready ? (row.episodeCompletions ?? 0) : null,
					activeObservations: ready ? (row.activeObservations ?? 0) : null,
					distinctTitles: ready ? (presence?.distinctTitles ?? null) : null,
					quantities:
						presence === undefined
							? null
							: {
									pages: quantityValue(row, presence, "pages", ready),
									minutes: quantityValue(row, presence, "minutes", ready),
									volumes: quantityValue(row, presence, "volumes", ready),
									episodes: quantityValue(row, presence, "episodes", ready),
									chapters: quantityValue(row, presence, "chapters", ready),
								},
				};
			}),
		};
	};
	return {
		processing: report.processing,
		reviews: stats?.reviews ?? null,
		current: period(report.current, stats?.current),
		previous:
			report.previous === null ? null : period(report.previous, stats?.previous ?? undefined),
	};
};

const chartValue = (
	rows: readonly QuantityMeasures[],
	metric: MediaAnalyticsMetric,
	processing: MediaConsumptionReport["processing"],
	partial: boolean,
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
			lowerBound: partial,
			value:
				partial && rows.length === 0
					? null
					: rows.reduce((total, row) => total + (row[metric] ?? 0), 0),
		};
	}
	const values = rows.map((row) => quantityValue(row, row, metric));
	const known = values.reduce((total, row) => total + (row.known ?? 0), 0);
	const missing = values.reduce((total, row) => total + (row.missing ?? 0), 0);
	const recorded = values.reduce((total, row) => total + (row.recorded ?? 0), 0);
	const estimated = values.reduce((total, row) => total + (row.estimated ?? 0), 0);
	return {
		known,
		missing,
		recorded,
		estimated,
		lowerBound: partial || missing > 0,
		value: known > 0 ? recorded + estimated : null,
	};
};
export type TrendBucket = ReturnType<typeof trendGrid>["buckets"][number];
export const trendGrid = (
	trend: MediaAnalyticsTrend,
	metric: MediaAnalyticsMetric,
	processing: MediaConsumptionReport["processing"],
	timeZone: TimeZone,
	mediaType?: string,
) => {
	const buckets = [];
	const partial = trend.pageInfo?.hasMore ?? false;
	for (
		let date = startOfCalendarUnit(trend.period.startDate, trend.grouping);
		date <= trend.period.endDate;
		date = addCalendarUnits(date, trend.grouping, 1)
	) {
		const endDate = addCalendarDays(addCalendarUnits(date, trend.grouping, 1), -1);
		const period = calendarPeriod(
			date < trend.period.startDate ? trend.period.startDate : date,
			endDate > trend.period.endDate ? trend.period.endDate : endDate,
			timeZone,
		);
		const rows = trend.items.filter(
			(row) => row.at === date && (mediaType === undefined || row.mediaType === mediaType),
		);
		buckets.push({
			date,
			period,
			sources: rows,
			at: period.startAt,
			...chartValue(rows, metric, processing, partial),
		});
	}
	return { buckets, partial, processing };
};
export const pairTrendBuckets = <Bucket>(
	current: readonly Bucket[],
	previous: readonly Bucket[],
) => ({
	extraPrevious: previous.slice(current.length),
	buckets: current.map((bucket, index) => ({ current: bucket, previous: previous[index] ?? null })),
});
export const trendModel = (
	current: MediaAnalyticsTrend,
	previous: null | MediaAnalyticsTrend,
	metric: MediaAnalyticsMetric,
	processing: MediaConsumptionReport["processing"],
	timeZone: TimeZone,
	mediaType?: string,
) => {
	const currentGrid = trendGrid(current, metric, processing, timeZone, mediaType);
	const previousGrid =
		previous === null ? null : trendGrid(previous, metric, processing, timeZone, mediaType);
	return {
		current: currentGrid,
		previous: previousGrid,
		partial: currentGrid.partial || (previousGrid?.partial ?? false),
		...pairTrendBuckets(currentGrid.buckets, previousGrid?.buckets ?? []),
	};
};
export const hourlyModel = (
	hours: MediaAnalyticsHours,
	metric: MediaAnalyticsMetric,
	processing: MediaConsumptionReport["processing"],
	mediaType?: string,
) => {
	const partial = hours.pageInfo?.hasMore ?? false;
	return {
		partial,
		hours: Array.from({ length: 24 }, (_, hour) => ({
			hour,
			...chartValue(
				hours.items.filter(
					(row) => row.hour === hour && (mediaType === undefined || row.mediaType === mediaType),
				),
				metric,
				processing,
				partial,
			),
		})),
	};
};
export const consistencyModel = (
	data: MediaAnalyticsConsistency,
	processing: MediaConsumptionReport["processing"],
) => {
	const days = [];
	const counts = new Map(data.days.map((row) => [row.day, row.events]));
	for (
		let date = data.period.startDate;
		date <= data.period.endDate;
		date = addCalendarDays(date, 1)
	) {
		days.push({
			date,
			value: processing !== "ready" ? null : (counts.get(date) ?? (data.hasMore ? null : 0)),
		});
	}
	return { days, processing, period: data.period, partial: data.hasMore };
};
export const rankingModel = (
	rows: MediaAnalyticsRanking["items"],
	processing: MediaConsumptionReport["processing"],
) =>
	rows.map((row) => ({
		...row,
		category: mediaTypeLabel(row.mediaType),
		titleCompletions: processing === "ready" ? row.titleCompletions : null,
		activeObservations: processing === "ready" ? row.activeObservations : null,
		episodeCompletions: processing === "ready" ? row.episodeCompletions : null,
	}));
export const reviewModel = (reviews: MediaAnalyticsStats["reviews"]) => ({
	current: {
		...reviews.current,
		categories: reviews.current.types.items.map((row) => ({
			...row,
			label: mediaTypeLabel(row.mediaType),
			kind: reviewTargetKind(row.mediaType),
		})),
	},
	previous:
		reviews.previous === null
			? null
			: {
					...reviews.previous,
					categories: reviews.previous.types.items.map((row) => ({
						...row,
						label: mediaTypeLabel(row.mediaType),
						kind: reviewTargetKind(row.mediaType),
					})),
				},
});
export const recordModel = (
	row: MediaAnalyticsRecord,
	processing: MediaConsumptionReport["processing"],
) => ({
	source: row,
	category: mediaTypeLabel(row.mediaType),
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
