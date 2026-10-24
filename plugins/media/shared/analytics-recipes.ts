import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castBoolean,
	castDate,
	castJson,
	castText,
	coalesce,
	column,
	conditional,
	defineRecipe,
	descending,
	eq,
	exists,
	groupAscending,
	gt,
	isNotNull,
	literal,
	localDate,
	localHour,
	schemaOwnerPredicate,
	selectedAggregate,
	selectedField,
	selectedMeasure,
	selectedRows,
	sum,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import {
	localDateOf,
	type ReportingPeriod,
	type ReportingSelection,
	resolveReportingSelection,
	type TimeZone,
	UTC,
} from "@ryot-app/plugin-kit/schema";

import { consumptionDailySelection } from "./activity-recipes";
import { ConsumedItem, ConsumptionBasis, SourceProgress } from "./consumption";
import type { ConsumptionMeasureUnit } from "./consumption-allocation";
import { ConsumptionContribution } from "./consumption-projection";
import {
	consumptionDetail,
	consumptionMeasures,
	consumptionNumber,
	consumptionPeriod,
	consumptionReviewMeasures,
	consumptionReviewSource,
	consumptionRows,
	type ConsumptionScope,
	consumptionScope,
	consumptionTrendSelection,
	consumptionValue,
} from "./consumption-recipes";
import type { Table } from "./entity-selections";

export type MediaAnalyticsWindow = { readonly endDate: string; readonly startDate: string };
export type MediaAnalyticsFilter = {
	readonly hour?: number;
	readonly mediaType?: string;
	readonly activeOnly?: boolean;
};
export type MediaAnalyticsCalendarInput = Omit<MediaAnalyticsInput, "selection"> & {
	readonly periods: MediaAnalyticsPeriods;
};
export type MediaAnalyticsInput = ConsumptionScope & {
	readonly now: number;
	readonly timeZone: TimeZone;
	readonly selection: ReportingSelection;
};
export type MediaAnalyticsPeriods = {
	readonly grouping: ReturnType<typeof resolveReportingSelection>["grouping"];
} & (
	| { readonly current: null; readonly previous: null }
	| { readonly current: MediaAnalyticsWindow; readonly previous: null | MediaAnalyticsWindow }
);
const periodDates = (period: ReportingPeriod): MediaAnalyticsWindow => ({
	endDate: period.endDate,
	startDate: period.startDate,
});
export const mediaAnalyticsPeriods = (
	resolved: ReturnType<typeof resolveReportingSelection>,
): MediaAnalyticsPeriods => {
	if (resolved.current === null) {
		return { current: null, previous: null, grouping: resolved.grouping };
	}
	return {
		grouping: resolved.grouping,
		current: periodDates(resolved.current),
		previous: resolved.previous === null ? null : periodDates(resolved.previous),
	};
};
export const resolveMediaAnalyticsPeriods = (
	input: Pick<MediaAnalyticsCalendarInput, "now" | "periods" | "timeZone">,
) => {
	const resolve = (window: null | MediaAnalyticsWindow) =>
		window === null
			? null
			: resolveReportingSelection(
					{
						comparison: "none",
						grouping: input.periods.grouping,
						range: { kind: "custom", ...window },
					},
					input,
				).current;
	const current = resolve(input.periods.current);
	if (current === null) {
		return {
			current: null,
			previous: null,
			timeZone: input.timeZone,
			grouping: input.periods.grouping,
		};
	}
	return {
		current,
		timeZone: input.timeZone,
		grouping: input.periods.grouping,
		previous: resolve(input.periods.previous),
	};
};

const nullableNumber = Schema.NullOr(Schema.Finite);
const sumWhen = (predicate: Parameters<typeof conditional>[0]) =>
	selectedMeasure(
		{ function: "sum", expr: conditional(predicate, literal(1), literal(0)) },
		nullableNumber,
	);
const attributionKind = (event: Table) => castText(consumptionValue(event, "attribution", "kind"));
export const consumptionActiveDay = (event: Table, timeZone: TimeZone) =>
	conditional(
		eq(attributionKind(event), literal("date")),
		castText(consumptionValue(event, "attribution", "value")),
		conditional(
			eq(attributionKind(event), literal("instant")),
			localDate(castDate(consumptionValue(event, "attribution", "value")), { timeZone }),
			literal(null),
		),
	);

export const consumptionQuantityPresence = (event: Table) => {
	const known = (unit: ConsumptionMeasureUnit) =>
		sumWhen(
			and(
				isNotNull(consumptionValue(event, unit)),
				eq(castBoolean(consumptionValue(event, unit, "missing")), literal(false)),
				eq(castBoolean(consumptionValue(event, unit, "supersededEstimate")), literal(false)),
			),
		);
	const superseded = (unit: ConsumptionMeasureUnit) =>
		sumWhen(eq(castBoolean(consumptionValue(event, unit, "supersededEstimate")), literal(true)));
	return {
		pagesKnown: known("pages"),
		minutesKnown: known("minutes"),
		volumesKnown: known("volumes"),
		episodesKnown: known("episodes"),
		chaptersKnown: known("chapters"),
		pagesSuperseded: superseded("pages"),
		minutesSuperseded: superseded("minutes"),
		volumesSuperseded: superseded("volumes"),
		episodesSuperseded: superseded("episodes"),
		chaptersSuperseded: superseded("chapters"),
	};
};

const statsMeasures = (event: Table, timeZone: TimeZone) => ({
	distinctTitles: selectedMeasure(
		{
			function: "countDistinct",
			expr: conditional(
				gt(consumptionNumber(event, "titleCompletions"), literal(0)),
				column(event, "entityId"),
				literal(null),
			),
		},
		Schema.Finite,
	),
	activeDays: selectedMeasure(
		{
			function: "countDistinct",
			expr: conditional(
				eq(castBoolean(consumptionValue(event, "activeObservation")), literal(true)),
				consumptionActiveDay(event, timeZone),
				literal(null),
			),
		},
		Schema.Finite,
	),
	...consumptionQuantityPresence(event),
});

export const mediaAnalyticsStatsRecipe = defineRecipe((input: MediaAnalyticsCalendarInput) => {
	const resolved = resolveMediaAnalyticsPeriods(input);
	const stats = (alias: string, period: null | ReportingPeriod, enabled: boolean) => {
		const source = consumptionDetail(input, alias, period);
		return {
			...source,
			where: and(source.where, ...(enabled ? [] : [eq(literal(false), literal(true))])),
		};
	};
	const current = stats("analyticsCurrent", resolved.current, true);
	const previous = stats("analyticsPrevious", resolved.previous, resolved.previous !== null);
	const review = (period: null | ReportingPeriod, enabled: boolean, alias: string) => {
		const source = consumptionReviewSource(input, period, `${alias}Event`, `${alias}Entity`);
		return {
			...source,
			where: and(
				source.where,
				schemaOwnerPredicate(source.entity, "entitySchemaPluginId", input.reference),
				...(enabled ? [] : [eq(literal(false), literal(true))]),
			),
		};
	};
	const currentReview = review(resolved.current, true, "analyticsCurrentReview");
	const previousReview = review(
		resolved.previous,
		resolved.previous !== null,
		"analyticsPreviousReview",
	);
	const globalStats = (source: typeof current) =>
		selectedAggregate(source.event, {
			joins: source.joins,
			where: source.where,
			measures: statsMeasures(source.event, input.timeZone),
		});
	const typeStats = (source: typeof current) =>
		selectedAggregate(source.event, {
			limit: 100,
			joins: source.joins,
			where: source.where,
			orderBy: [groupAscending("mediaType")],
			measures: statsMeasures(source.event, input.timeZone),
			groupBy: {
				mediaType: selectedField(column(source.entity, "entitySchemaSlug"), Schema.String),
			},
		});
	const globalReviews = (source: typeof currentReview) =>
		selectedAggregate(source.review, {
			joins: source.joins,
			where: source.where,
			measures: consumptionReviewMeasures(source.review),
		});
	const typeReviews = (source: typeof currentReview) =>
		selectedAggregate(source.review, {
			limit: 100,
			joins: source.joins,
			where: source.where,
			orderBy: [groupAscending("mediaType")],
			measures: consumptionReviewMeasures(source.review),
			groupBy: {
				mediaType: selectedField(column(source.entity, "entitySchemaSlug"), Schema.String),
			},
		});
	return {
		queries: {
			currentTypes: typeStats(current),
			previousTypes: typeStats(previous),
			currentGlobal: globalStats(current),
			previousGlobal: globalStats(previous),
			currentReviews: globalReviews(currentReview),
			currentReviewTypes: typeReviews(currentReview),
			previousReviews: globalReviews(previousReview),
			previousReviewTypes: typeReviews(previousReview),
		},
		map: ({
			currentTypes,
			currentGlobal,
			previousTypes,
			previousGlobal,
			currentReviews,
			previousReviews,
			currentReviewTypes,
			previousReviewTypes,
		}) =>
			Result.succeed({
				current: { types: currentTypes, global: currentGlobal },
				previous:
					resolved.previous === null ? null : { types: previousTypes, global: previousGlobal },
				reviews: {
					current: { global: currentReviews, types: currentReviewTypes },
					previous:
						resolved.previous === null
							? null
							: { global: previousReviews, types: previousReviewTypes },
				},
			}),
	};
});

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const bucketNumber = (
	date: string,
	grouping: ReturnType<typeof resolveReportingSelection>["grouping"],
) => {
	if (grouping === "year") {
		return Number(date.slice(0, 4));
	}
	if (grouping === "month") {
		return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
	}
	return grouping === "week" ? Math.floor((dayNumber(date) + 3) / 7) : dayNumber(date);
};
const windowPeriod = (
	input: MediaAnalyticsCalendarInput,
	window: MediaAnalyticsWindow,
	daily: boolean,
	prior = false,
) => {
	const resolved = resolveMediaAnalyticsPeriods(input);
	const period = prior ? resolved.previous : resolved.current;
	if (window.startDate > window.endDate) {
		throw new Error("Analytics window dates are reversed");
	}
	if (prior && period === null) {
		throw new Error("No previous reporting period");
	}
	const grouping = daily ? "day" : resolved.grouping;
	if (
		bucketNumber(window.endDate, grouping) - bucketNumber(window.startDate, grouping) + 1 >
		(daily ? 400 : 32)
	) {
		throw new Error("Analytics window exceeds its calendar bucket bound");
	}
	if (period !== null && (window.startDate < period.startDate || window.endDate > period.endDate)) {
		throw new Error("Analytics window is outside the reporting period");
	}
	const bounded = resolveReportingSelection(
		{ grouping, comparison: "none", range: { kind: "custom", ...window } },
		input,
	).current;
	if (bounded === null) {
		throw new Error("Analytics window must be dated");
	}
	return { grouping, period: bounded };
};

export const mediaAnalyticsTrendRecipe = defineRecipe(
	(
		input: MediaAnalyticsCalendarInput & {
			readonly window: MediaAnalyticsWindow;
			readonly period?: "current" | "previous";
		},
	) => {
		const { period, grouping } = windowPeriod(
			input,
			input.window,
			false,
			input.period === "previous",
		);
		const source = consumptionTrendSelection(input, period, grouping, "analyticsTrend");
		return {
			queries: {
				trend: selectedAggregate(source.event, {
					...source.selection,
					measures: { ...source.selection.measures, ...consumptionQuantityPresence(source.event) },
				}),
			},
			map: ({ trend }) =>
				Result.succeed({
					...trend,
					period,
					grouping,
					items: trend.items.map((row) => ({
						...row,
						at: localDateOf(row.at, row.precision === "date" ? UTC : input.timeZone),
					})),
				}),
		};
	},
);

export const mediaAnalyticsHoursRecipe = defineRecipe((input: MediaAnalyticsCalendarInput) => {
	const resolved = resolveMediaAnalyticsPeriods(input);
	const source = consumptionDetail(input, "analyticsHour", resolved.current);
	return {
		map: ({ hourly }) => Result.succeed(hourly),
		queries: {
			hourly: selectedAggregate(source.event, {
				limit: 1000,
				joins: source.joins,
				orderBy: [groupAscending("hour"), groupAscending("mediaType")],
				where: and(source.where, eq(attributionKind(source.event), literal("instant"))),
				measures: {
					...consumptionMeasures(source.event),
					...consumptionQuantityPresence(source.event),
				},
				groupBy: {
					mediaType: selectedField(column(source.entity, "entitySchemaSlug"), Schema.String),
					hour: selectedField(
						localHour(castDate(consumptionValue(source.event, "attribution", "value")), {
							timeZone: input.timeZone,
						}),
						Schema.Finite,
					),
				},
			}),
		},
	};
});

export const mediaAnalyticsConsistencyRecipe = defineRecipe(
	(input: MediaAnalyticsCalendarInput & { readonly window: MediaAnalyticsWindow }) => {
		const { period } = windowPeriod(input, input.window, true);
		const source = consumptionDetail(input, "analyticsConsistency", period);
		return {
			queries: {
				dates: consumptionDailySelection(source, "date", { ...input, period }),
				instants: consumptionDailySelection(source, "instant", { ...input, period }),
			},
			map: ({ dates, instants }) => {
				const counts = new Map<string, number>();
				for (const row of [
					...dates.items,
					...instants.items.map((item) => ({
						...item,
						day: localDateOf(item.day, input.timeZone),
					})),
				]) {
					counts.set(row.day, (counts.get(row.day) ?? 0) + row.events);
				}
				return Result.succeed({
					period,
					hasMore: (dates.pageInfo?.hasMore ?? false) || (instants.pageInfo?.hasMore ?? false),
					days: [...counts]
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([day, events]) => ({ day, events })),
				});
			},
		};
	},
);

export const mediaAnalyticsRankingRecipe = defineRecipe(
	(input: MediaAnalyticsInput & { readonly after?: string; readonly mediaType?: string }) => {
		const period = resolveReportingSelection(input.selection, input).current;
		const entity = table("entity", "analyticsRankEntity");
		const event = table("event", "analyticsRankEvent");
		const where = and(
			consumptionScope(event, input),
			consumptionRows(event),
			consumptionPeriod(event, period),
			eq(column(event, "entityId"), column(entity, "id")),
		);
		const score = coalesce(
			sum(
				event,
				conditional(
					eq(castBoolean(consumptionValue(event, "activeObservation")), literal(true)),
					literal(1),
					literal(0),
				),
				{ where },
			),
			literal(0),
		);
		return {
			map: ({ ranking }) => Result.succeed(ranking),
			queries: {
				ranking: selectedRows(entity, {
					limit: 100,
					after: input.after,
					orderBy: [descending(score), ascending(column(entity, "id"))],
					where: and(
						schemaOwnerPredicate(entity, "entitySchemaPluginId", input.reference),
						exists(event, { where }),
						...(input.mediaType === undefined
							? []
							: [eq(column(entity, "entitySchemaSlug"), literal(input.mediaType))]),
					),
					selection: {
						activeObservations: selectedField(score, Schema.Finite),
						name: selectedField(column(entity, "name"), Schema.String),
						entityId: selectedField(column(entity, "id"), Schema.String),
						mediaType: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
						titleCompletions: selectedField(
							coalesce(
								sum(event, consumptionNumber(event, "titleCompletions"), { where }),
								literal(0),
							),
							Schema.Finite,
						),
						episodeCompletions: selectedField(
							coalesce(
								sum(event, consumptionNumber(event, "episodeCompletions"), { where }),
								literal(0),
							),
							Schema.Finite,
						),
					},
				}),
			},
		};
	},
);

export const MediaConsumptionFacts = Schema.Struct({
	timeSpent: Schema.optionalKey(Schema.Finite),
	sourceRun: Schema.optionalKey(Schema.String),
	consumedOn: Schema.optionalKey(Schema.String),
	mangaVolume: Schema.optionalKey(Schema.Finite),
	consumedItem: Schema.optionalKey(ConsumedItem),
	calendarDate: Schema.optionalKey(Schema.String),
	dateUnknown: Schema.optionalKey(Schema.Boolean),
	animeEpisode: Schema.optionalKey(Schema.Finite),
	mangaChapter: Schema.optionalKey(Schema.Finite),
	progressPages: Schema.optionalKey(Schema.Finite),
	completionKey: Schema.optionalKey(Schema.String),
	progressPercent: Schema.optionalKey(Schema.Finite),
	sourceProgress: Schema.optionalKey(SourceProgress),
	consumptionBasis: Schema.optionalKey(ConsumptionBasis),
});

export const mediaAnalyticsRecordsRecipe = defineRecipe(
	(input: MediaAnalyticsInput & MediaAnalyticsFilter & { readonly after?: string }) => {
		const period = resolveReportingSelection(input.selection, input).current;
		const source = consumptionDetail(input, "analyticsRecord", period);
		const event = source.event;
		return {
			map: ({ records }) => Result.succeed(records),
			queries: {
				records: selectedRows(event, {
					limit: 100,
					after: input.after,
					joins: source.joins,
					orderBy: [
						descending(column(event, "occurredAt")),
						descending(column(event, "orderCreatedAt")),
						descending(column(event, "orderKey")),
						descending(column(event, "id")),
					],
					where: and(
						source.where,
						schemaOwnerPredicate(source.entity, "entitySchemaPluginId", input.reference),
						...(input.mediaType === undefined
							? []
							: [eq(column(source.entity, "entitySchemaSlug"), literal(input.mediaType))]),
						...(input.activeOnly === true
							? [eq(castBoolean(consumptionValue(event, "activeObservation")), literal(true))]
							: []),
						...(input.hour === undefined
							? []
							: [
									eq(attributionKind(event), literal("instant")),
									eq(
										localHour(castDate(consumptionValue(event, "attribution", "value")), {
											timeZone: input.timeZone,
										}),
										literal(input.hour),
									),
								]),
					),
					selection: {
						id: selectedField(column(event, "id"), Schema.String),
						entityId: selectedField(column(event, "entityId"), Schema.String),
						name: selectedField(column(source.entity, "name"), Schema.String),
						orderKey: selectedField(column(event, "orderKey"), Schema.String),
						occurredAt: selectedField(column(event, "occurredAt"), Schema.String),
						eventType: selectedField(column(event, "eventSchemaSlug"), Schema.String),
						orderCreatedAt: selectedField(column(event, "orderCreatedAt"), Schema.String),
						mediaType: selectedField(column(source.entity, "entitySchemaSlug"), Schema.String),
						facts: selectedField(castJson(column(event, "properties")), MediaConsumptionFacts),
						contribution: selectedField(castJson(consumptionValue(event)), ConsumptionContribution),
					},
				}),
			},
		};
	},
);
