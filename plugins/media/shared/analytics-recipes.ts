import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castBoolean,
	castDate,
	castJson,
	castNumber,
	castText,
	coalesce,
	column,
	conditional,
	contains,
	dateBucket,
	defineRecipe,
	descending,
	eq,
	exists,
	groupAscending,
	gt,
	isNotNull,
	join,
	jsonPath,
	literal,
	localDate,
	localHour,
	not,
	schemaOwnerPredicate,
	selectedAggregate,
	selectedField,
	selectedMeasure,
	selectedRows,
	sum,
	table,
	withinPeriod,
} from "@ryot-app/plugin-kit/ryotql";
import {
	type CalendarUnit,
	REPORTING_BUCKET_LIMIT,
	type ReportingPeriod,
	type ReportingSelection,
	resolveReportingSelection,
	type TimeZone,
	UTC,
} from "@ryot-app/plugin-kit/schema";

import { ConsumedItem, ConsumptionBasis, SourceProgress } from "./consumption";
import type { ConsumptionMeasureUnit } from "./consumption-allocation";
import { ConsumptionContribution, consumptionProcessingState } from "./consumption-projection";
import {
	consumptionActiveDay,
	consumptionDetail,
	consumptionNumber,
	consumptionPeriod,
	consumptionRows,
	type ConsumptionScope,
	consumptionScope,
	consumptionValue,
	mediaTypeJoin,
} from "./consumption-recipes";
import type { Table } from "./entity-selections";

export type MediaAnalyticsFilter = {
	readonly hour?: number;
	readonly mediaType?: string;
	readonly activeOnly?: boolean;
};
export type MediaAnalyticsInput = ConsumptionScope & {
	readonly now: number;
	readonly timeZone: TimeZone;
	readonly selection: ReportingSelection;
};

const nullableNumber = Schema.NullOr(Schema.Finite);
const sumOf = (expr: Parameters<typeof coalesce>[0]) =>
	selectedMeasure({ expr, function: "sum" }, nullableNumber);
const countWhen = (predicate: Parameters<typeof conditional>[0]) =>
	sumOf(conditional(predicate, literal(1), literal(0)));
const flag = (event: Table, ...path: string[]) =>
	eq(castBoolean(consumptionValue(event, ...path)), literal(true));
const attributionKind = (event: Table) => castText(consumptionValue(event, "attribution", "kind"));
const attributedAt = (event: Table) => castDate(consumptionValue(event, "attribution", "value"));

const consumptionBucket = (event: Table, timeZone: TimeZone, bucket: CalendarUnit) =>
	conditional(
		eq(attributionKind(event), literal("date")),
		localDate(dateBucket(attributedAt(event), { bucket, timeZone: UTC }), { timeZone: UTC }),
		localDate(dateBucket(attributedAt(event), { bucket, timeZone }), { timeZone }),
	);

const recorded = (event: Table, unit: ConsumptionMeasureUnit) =>
	sumOf(coalesce(consumptionNumber(event, unit, "recorded"), literal(0)));
const estimated = (event: Table, unit: ConsumptionMeasureUnit) =>
	sumOf(coalesce(consumptionNumber(event, unit, "estimated"), literal(0)));
const missing = (event: Table, unit: ConsumptionMeasureUnit) =>
	countWhen(flag(event, unit, "missing"));
const superseded = (event: Table, unit: ConsumptionMeasureUnit) =>
	countWhen(flag(event, unit, "supersededEstimate"));
const known = (event: Table, unit: ConsumptionMeasureUnit) =>
	countWhen(
		and(
			isNotNull(consumptionValue(event, unit)),
			not(flag(event, unit, "missing")),
			not(flag(event, unit, "supersededEstimate")),
		),
	);

export const consumptionMeasures = (event: Table) => ({
	pagesKnown: known(event, "pages"),
	minutesKnown: known(event, "minutes"),
	pagesMissing: missing(event, "pages"),
	volumesKnown: known(event, "volumes"),
	pagesRecorded: recorded(event, "pages"),
	episodesKnown: known(event, "episodes"),
	chaptersKnown: known(event, "chapters"),
	minutesMissing: missing(event, "minutes"),
	pagesEstimated: estimated(event, "pages"),
	volumesMissing: missing(event, "volumes"),
	minutesRecorded: recorded(event, "minutes"),
	pagesSuperseded: superseded(event, "pages"),
	episodesMissing: missing(event, "episodes"),
	chaptersMissing: missing(event, "chapters"),
	volumesRecorded: recorded(event, "volumes"),
	minutesEstimated: estimated(event, "minutes"),
	episodesRecorded: recorded(event, "episodes"),
	chaptersRecorded: recorded(event, "chapters"),
	volumesEstimated: estimated(event, "volumes"),
	minutesSuperseded: superseded(event, "minutes"),
	episodesEstimated: estimated(event, "episodes"),
	chaptersEstimated: estimated(event, "chapters"),
	volumesSuperseded: superseded(event, "volumes"),
	episodesSuperseded: superseded(event, "episodes"),
	chaptersSuperseded: superseded(event, "chapters"),
	activeObservations: countWhen(flag(event, "activeObservation")),
	titleCompletions: sumOf(coalesce(consumptionNumber(event, "titleCompletions"), literal(0))),
	episodeCompletions: sumOf(coalesce(consumptionNumber(event, "episodeCompletions"), literal(0))),
});

const activeDays = (event: Table, timeZone: TimeZone) =>
	selectedMeasure(
		{
			function: "countDistinct",
			expr: conditional(
				flag(event, "activeObservation"),
				consumptionActiveDay(event, timeZone),
				literal(null),
			),
		},
		Schema.Finite,
	);

const periodSummary = (
	input: MediaAnalyticsInput,
	period: null | ReportingPeriod,
	alias: string,
) => {
	const source = consumptionDetail(input, `${alias}Consumption`, period);
	const type = mediaTypeJoin(source.entity, `${alias}Type`, input.reference);
	const review = table("event", `${alias}Review`);
	const reviewed = table("entity", `${alias}Reviewed`);
	const reviewType = mediaTypeJoin(reviewed, `${alias}ReviewType`, input.reference);
	return {
		activeDays: selectedAggregate(source.event, {
			joins: source.joins,
			where: source.where,
			measures: { activeDays: activeDays(source.event, input.timeZone) },
		}),
		types: selectedAggregate(source.event, {
			limit: 100,
			where: source.where,
			joins: [...source.joins, type.join],
			orderBy: [groupAscending("mediaType")],
			groupBy: { label: type.label, mediaType: type.slug },
			measures: {
				...consumptionMeasures(source.event),
				activeDays: activeDays(source.event, input.timeZone),
				distinctTitles: selectedMeasure(
					{
						function: "countDistinct",
						expr: conditional(
							gt(consumptionNumber(source.event, "titleCompletions"), literal(0)),
							column(source.event, "entityId"),
							literal(null),
						),
					},
					Schema.Finite,
				),
			},
		}),
		reviews: selectedAggregate(review, {
			limit: 100,
			orderBy: [groupAscending("mediaType")],
			groupBy: { label: reviewType.label, mediaType: reviewType.slug },
			joins: [
				join("inner", reviewed, eq(column(review, "entityId"), column(reviewed, "id"))),
				reviewType.join,
			],
			where: and(
				consumptionScope(review, input),
				schemaOwnerPredicate(reviewed, "entitySchemaPluginId", input.reference),
				eq(column(review, "eventSchemaSlug"), literal("review")),
				withinPeriod(column(review, "occurredAt"), period),
			),
			measures: {
				reviews: selectedMeasure({ function: "count" }, Schema.Finite),
				rated: countWhen(isNotNull(jsonPath(column(review, "properties"), "rating"))),
				averageRating: selectedMeasure(
					{
						function: "average",
						expr: castNumber(jsonPath(column(review, "properties"), "rating")),
					},
					nullableNumber,
				),
			},
		}),
	};
};

/** Period totals by media type, global active days and reviews, with full-history coverage. */
export const mediaAnalyticsSummaryRecipe = defineRecipe((input: MediaAnalyticsInput) => {
	const resolved = resolveReportingSelection(input.selection, input);
	const current = periodSummary(input, resolved.current, "current");
	const previous =
		resolved.previous === null ? undefined : periodSummary(input, resolved.previous, "previous");
	const stream = table("eventStream", "coverageStream");
	const undated = table("event", "undatedEvent");
	return {
		map: (result) => {
			const period = (
				types: undefined | typeof result.currentTypes,
				reviews: undefined | typeof result.currentReviews,
				days: undefined | typeof result.currentActiveDays,
			) =>
				types === undefined || reviews === undefined || days === undefined
					? null
					: { types: types.items, reviews: reviews.items, activeDays: days.activeDays };
			return Result.succeed({
				unknownDate: result.undated.count,
				previous: period(result.previousTypes, result.previousReviews, result.previousActiveDays),
				processing: consumptionProcessingState(
					result.processing.pending ?? 0,
					result.processing.failed ?? 0,
				),
				current: {
					types: result.currentTypes.items,
					reviews: result.currentReviews.items,
					activeDays: result.currentActiveDays.activeDays,
				},
			});
		},
		queries: {
			currentTypes: current.types,
			previousTypes: previous?.types,
			currentReviews: current.reviews,
			previousReviews: previous?.reviews,
			currentActiveDays: current.activeDays,
			previousActiveDays: previous?.activeDays,
			undated: selectedAggregate(undated, {
				measures: { count: selectedMeasure({ function: "count" }, Schema.Finite) },
				where: and(
					consumptionScope(undated, input),
					consumptionRows(undated),
					contains(column(undated, "properties"), literal({ dateUnknown: true })),
				),
			}),
			processing: selectedAggregate(stream, {
				where: and(consumptionScope(stream, input), consumptionRows(stream)),
				measures: {
					failed: countWhen(eq(column(stream, "projectionStatus"), literal("failed"))),
					pending: countWhen(eq(column(stream, "projectionStatus"), literal("pending"))),
				},
			}),
		},
	};
});

const filtered = (source: ReturnType<typeof consumptionDetail>, mediaType: string | undefined) =>
	mediaType === undefined
		? source.where
		: and(source.where, eq(column(source.entity, "entitySchemaSlug"), literal(mediaType)));

/** Consumption by local calendar bucket for the current period and, when compared, the previous. */
export const mediaAnalyticsTrendRecipe = defineRecipe(
	(input: MediaAnalyticsInput & { readonly mediaType?: string }) => {
		const resolved = resolveReportingSelection(input.selection, input);
		const trend = (period: null | ReportingPeriod, alias: string) => {
			const source = consumptionDetail(input, alias, period);
			return selectedAggregate(source.event, {
				joins: source.joins,
				limit: REPORTING_BUCKET_LIMIT,
				orderBy: [groupAscending("at")],
				measures: consumptionMeasures(source.event),
				where: and(
					filtered(source, input.mediaType),
					isNotNull(consumptionActiveDay(source.event, input.timeZone)),
				),
				groupBy: {
					at: selectedField(
						consumptionBucket(source.event, input.timeZone, resolved.grouping),
						Schema.String,
					),
				},
			});
		};
		return {
			queries: {
				current: trend(resolved.current, "trendCurrent"),
				previous:
					resolved.previous === null ? undefined : trend(resolved.previous, "trendPrevious"),
			},
			map: ({ current, previous }) =>
				Result.succeed({
					grouping: resolved.grouping,
					current: { items: current.items, period: resolved.current },
					previous:
						previous === undefined || resolved.previous === null
							? null
							: { items: previous.items, period: resolved.previous },
				}),
		};
	},
);

export const mediaAnalyticsHoursRecipe = defineRecipe(
	(input: MediaAnalyticsInput & { readonly mediaType?: string }) => {
		const period = resolveReportingSelection(input.selection, input).current;
		const source = consumptionDetail(input, "analyticsHour", period);
		return {
			map: ({ hourly }) => Result.succeed(hourly.items),
			queries: {
				hourly: selectedAggregate(source.event, {
					limit: 24,
					joins: source.joins,
					orderBy: [groupAscending("hour")],
					measures: consumptionMeasures(source.event),
					where: and(
						filtered(source, input.mediaType),
						eq(attributionKind(source.event), literal("instant")),
					),
					groupBy: {
						hour: selectedField(
							localHour(attributedAt(source.event), { timeZone: input.timeZone }),
							Schema.Finite,
						),
					},
				}),
			},
		};
	},
);

export const mediaAnalyticsRankingRecipe = defineRecipe(
	(input: MediaAnalyticsInput & { readonly after?: string; readonly mediaType?: string }) => {
		const period = resolveReportingSelection(input.selection, input).current;
		const entity = table("entity", "analyticsRankEntity");
		const event = table("event", "analyticsRankEvent");
		const type = mediaTypeJoin(entity, "analyticsRankType", input.reference);
		const where = and(
			consumptionScope(event, input),
			consumptionRows(event),
			consumptionPeriod(event, period),
			eq(column(event, "entityId"), column(entity, "id")),
		);
		const total = (expr: Parameters<typeof sum>[1]) =>
			coalesce(sum(event, expr, { where }), literal(0));
		const score = total(conditional(flag(event, "activeObservation"), literal(1), literal(0)));
		return {
			map: ({ ranking }) => Result.succeed(ranking),
			queries: {
				ranking: selectedRows(entity, {
					limit: 100,
					after: input.after,
					joins: [type.join],
					orderBy: [descending(score), ascending(column(entity, "id"))],
					where: and(
						schemaOwnerPredicate(entity, "entitySchemaPluginId", input.reference),
						exists(event, { where }),
						...(input.mediaType === undefined
							? []
							: [eq(column(entity, "entitySchemaSlug"), literal(input.mediaType))]),
					),
					selection: {
						label: type.label,
						mediaType: type.slug,
						activeObservations: selectedField(score, Schema.Finite),
						name: selectedField(column(entity, "name"), Schema.String),
						entityId: selectedField(column(entity, "id"), Schema.String),
						titleCompletions: selectedField(
							total(consumptionNumber(event, "titleCompletions")),
							Schema.Finite,
						),
						episodeCompletions: selectedField(
							total(consumptionNumber(event, "episodeCompletions")),
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
		const type = mediaTypeJoin(source.entity, "analyticsRecordType", input.reference);
		const event = source.event;
		return {
			map: ({ records }) => Result.succeed(records),
			queries: {
				records: selectedRows(event, {
					limit: 100,
					after: input.after,
					joins: [...source.joins, type.join],
					orderBy: [
						descending(column(event, "occurredAt")),
						descending(column(event, "orderCreatedAt")),
						descending(column(event, "orderKey")),
						descending(column(event, "id")),
					],
					where: and(
						filtered(source, input.mediaType),
						...(input.activeOnly === true ? [flag(event, "activeObservation")] : []),
						...(input.hour === undefined
							? []
							: [
									eq(attributionKind(event), literal("instant")),
									eq(
										localHour(attributedAt(event), { timeZone: input.timeZone }),
										literal(input.hour),
									),
								]),
					),
					selection: {
						label: type.label,
						mediaType: type.slug,
						id: selectedField(column(event, "id"), Schema.String),
						entityId: selectedField(column(event, "entityId"), Schema.String),
						name: selectedField(column(source.entity, "name"), Schema.String),
						orderKey: selectedField(column(event, "orderKey"), Schema.String),
						occurredAt: selectedField(column(event, "occurredAt"), Schema.String),
						eventType: selectedField(column(event, "eventSchemaSlug"), Schema.String),
						orderCreatedAt: selectedField(column(event, "orderCreatedAt"), Schema.String),
						facts: selectedField(castJson(column(event, "properties")), MediaConsumptionFacts),
						contribution: selectedField(castJson(consumptionValue(event)), ConsumptionContribution),
					},
				}),
			},
		};
	},
);
