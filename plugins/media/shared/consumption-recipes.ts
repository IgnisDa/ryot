import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	add,
	and,
	castBoolean,
	castDate,
	castNumber,
	castText,
	coalesce,
	column,
	conditional,
	count,
	dateBucket,
	defineRecipe,
	eq,
	groupAscending,
	gte,
	inArray,
	isNotNull,
	isNull,
	join,
	jsonPath,
	literal,
	localHour,
	lt,
	lte,
	measureDescending,
	not,
	or,
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
	localDateOf,
	type PluginIdentityReference,
	type ReportingPeriod,
	type ReportingSelection,
	resolveReportingSelection,
	type TimeZone,
	UTC,
} from "@ryot-app/plugin-kit/schema";

import { type ConsumptionMeasureUnit, consumptionMeasureUnits } from "./consumption-allocation";
import { consumptionEventSlugs, consumptionProcessingState } from "./consumption-projection";
import { propertyBoolean, propertyText } from "./entity-selections";

type Table = ReturnType<typeof table>;
export const consumptionValue = (event: Table, ...path: string[]) =>
	jsonPath(column(event, "projection"), "contribution", ...path);
export const consumptionNumber = (event: Table, ...path: string[]) =>
	castNumber(consumptionValue(event, ...path));
export const consumptionRows = (event: Table) =>
	inArray(column(event, "eventSchemaSlug"), consumptionEventSlugs.map(literal));
export const consumptionReady = (event: Table) =>
	and(
		eq(coalesce(column(event, "projectionStatus"), literal("pending")), literal("ready")),
		isNotNull(column(event, "projection")),
		isNotNull(consumptionValue(event)),
	);
export const consumptionAmount = (event: Table, unit: ConsumptionMeasureUnit) =>
	add(
		coalesce(consumptionNumber(event, unit, "recorded"), literal(0)),
		coalesce(consumptionNumber(event, unit, "estimated"), literal(0)),
	);

export const consumptionActiveWork = (reference: PluginIdentityReference) => {
	const work = table("backgroundWork", "consumptionActiveWork");
	return selectedRows(work, {
		limit: 1,
		selection: { id: selectedField(column(work, "id"), Schema.String) },
		where: and(
			schemaOwnerPredicate(work, "pluginId", reference),
			inArray(column(work, "status"), [literal("queued"), literal("running")]),
		),
	});
};
export const consumptionPeriod = (event: Table, period: null | ReportingPeriod) => {
	if (period === null) {
		return consumptionReady(event);
	}
	const kind = castText(consumptionValue(event, "attribution", "kind"));
	const date = castText(consumptionValue(event, "attribution", "value"));
	const calendarDate = propertyText(event, "calendarDate");
	return and(
		consumptionReady(event),
		eq(coalesce(propertyBoolean(event, "dateUnknown"), literal(false)), literal(false)),
		or(
			and(gte(calendarDate, literal(period.startDate)), lte(calendarDate, literal(period.endDate))),
			and(isNull(calendarDate), withinPeriod(column(event, "occurredAt"), period)),
		),
		or(
			and(eq(kind, literal("instant")), withinPeriod(castDate(date), period)),
			and(
				eq(kind, literal("date")),
				gte(date, literal(period.startDate)),
				lte(date, literal(period.endDate)),
			),
		),
	);
};

export const mediaConsumptionTotalsSelection = (entity: Table, unit: ConsumptionMeasureUnit) => {
	const event = table("event", "consumptionTotalsEvent");
	const scope = and(
		eq(column(event, "entityId"), column(entity, "id")),
		eq(column(event, "eventSchemaPluginId"), column(entity, "entitySchemaPluginId")),
		consumptionRows(event),
	);
	return consumptionTotalsSelection(event, scope, unit);
};

export const consumptionTotalsSelection = (
	event: Table,
	scope: ReturnType<typeof and>,
	unit: ConsumptionMeasureUnit,
) => {
	const ready = and(scope, consumptionReady(event));
	return {
		consumptionPendingCount: selectedField(
			count(event, { where: and(scope, not(consumptionReady(event))) }),
			Schema.Finite,
		),
		consumedAmount: selectedField(
			sum(event, consumptionAmount(event, unit), { where: ready }),
			Schema.NullOr(Schema.Finite),
		),
		consumptionFailedCount: selectedField(
			count(event, { where: and(scope, eq(column(event, "projectionStatus"), literal("failed"))) }),
			Schema.Finite,
		),
		completionCount: selectedField(
			coalesce(
				sum(event, consumptionNumber(event, "titleCompletions"), { where: ready }),
				literal(0),
			),
			Schema.Finite,
		),
		unknownAmountCount: selectedField(
			count(event, {
				where: and(ready, eq(castBoolean(consumptionValue(event, unit, "missing")), literal(true))),
			}),
			Schema.Finite,
		),
	};
};

const sumNumber = (expr: Parameters<typeof add>[0]) =>
	selectedMeasure({ expr, function: "sum" }, Schema.NullOr(Schema.Finite));

export type ConsumptionScope = {
	readonly entityId?: string | undefined;
	readonly reference: PluginIdentityReference;
};

export const consumptionScope = (event: Table, input: ConsumptionScope) =>
	and(
		schemaOwnerPredicate(event, "eventSchemaPluginId", input.reference),
		...(input.entityId === undefined
			? []
			: [eq(column(event, "entityId"), literal(input.entityId))]),
	);

export const consumptionDetail = (
	input: ConsumptionScope,
	alias: string,
	period: null | ReportingPeriod,
) => {
	const event = table("event", `${alias}Event`);
	const entity = table("entity", `${alias}Entity`);
	return {
		event,
		entity,
		joins: [join("inner", entity, eq(column(entity, "id"), column(event, "entityId")))],
		where: and(
			consumptionScope(event, input),
			consumptionRows(event),
			consumptionPeriod(event, period),
		),
	};
};

export const consumptionMeasures = (event: Table, totals = false) => {
	const quantity = (unit: ConsumptionMeasureUnit, field: "recorded" | "estimated") =>
		sumNumber(
			totals
				? coalesce(consumptionNumber(event, unit, field), literal(0))
				: consumptionNumber(event, unit, field),
		);
	const missing = (unit: ConsumptionMeasureUnit) =>
		sumNumber(
			conditional(
				eq(castBoolean(consumptionValue(event, unit, "missing")), literal(true)),
				literal(1),
				literal(0),
			),
		);
	const completion = (field: "titleCompletions" | "episodeCompletions") =>
		sumNumber(
			totals
				? coalesce(consumptionNumber(event, field), literal(0))
				: consumptionNumber(event, field),
		);
	return {
		titleCompletions: completion("titleCompletions"),

		episodeCompletions: completion("episodeCompletions"),

		activeObservations: sumNumber(
			conditional(
				eq(castBoolean(consumptionValue(event, "activeObservation")), literal(true)),
				literal(1),
				literal(0),
			),
		),

		minutesRecorded: quantity("minutes", "recorded"),

		minutesEstimated: quantity("minutes", "estimated"),

		minutesMissing: missing("minutes"),

		pagesRecorded: quantity("pages", "recorded"),

		pagesEstimated: quantity("pages", "estimated"),

		pagesMissing: missing("pages"),

		episodesRecorded: quantity("episodes", "recorded"),

		episodesEstimated: quantity("episodes", "estimated"),

		episodesMissing: missing("episodes"),

		chaptersRecorded: quantity("chapters", "recorded"),

		chaptersEstimated: quantity("chapters", "estimated"),

		chaptersMissing: missing("chapters"),

		volumesRecorded: quantity("volumes", "recorded"),

		volumesEstimated: quantity("volumes", "estimated"),

		volumesMissing: missing("volumes"),
	};
};

export const consumptionTrendSelection = (
	input: ConsumptionScope & { readonly timeZone: TimeZone },
	period: null | ReportingPeriod,
	grouping: ReturnType<typeof resolveReportingSelection>["grouping"],
	alias = "consumptionTrend",
) => {
	const trend = consumptionDetail(input, alias, period);
	const kind = castText(consumptionValue(trend.event, "attribution", "kind"));
	const at = castDate(consumptionValue(trend.event, "attribution", "value"));
	return {
		event: trend.event,
		selection: {
			limit: 1000,
			joins: trend.joins,
			measures: consumptionMeasures(trend.event),
			where: and(trend.where, inArray(kind, [literal("date"), literal("instant")])),
			orderBy: [
				groupAscending("at"),
				groupAscending("mediaType"),
				groupAscending("precision"),
			] as const,
			groupBy: {
				precision: selectedField(kind, Schema.Literals(["date", "instant"])),

				mediaType: selectedField(column(trend.entity, "entitySchemaSlug"), Schema.String),

				at: selectedField(
					conditional(
						eq(kind, literal("date")),
						dateBucket(at, {
							timeZone: UTC,

							bucket: grouping,
						}),
						dateBucket(at, {
							timeZone: input.timeZone,

							bucket: grouping,
						}),
					),
					Schema.String,
				),
			},
		},
	};
};

export const consumptionReviewSource = (
	input: ConsumptionScope,
	period: null | ReportingPeriod,
	reviewAlias = "consumptionReview",
	entityAlias = "consumptionReviewedEntity",
) => {
	const review = table("event", reviewAlias);
	const entity = table("entity", entityAlias);
	return {
		review,
		entity,
		joins: [join("inner", entity, eq(column(review, "entityId"), column(entity, "id")))],
		where: and(
			consumptionScope(review, input),
			eq(column(review, "eventSchemaSlug"), literal("review")),
			...(period === null
				? []
				: [
						gte(column(review, "occurredAt"), castDate(literal(period.startAt))),
						lt(column(review, "occurredAt"), castDate(literal(period.endAt))),
					]),
		),
	};
};

export const consumptionReviewMeasures = (review: Table) => ({
	reviews: selectedMeasure({ function: "count" }, Schema.Finite),

	rated: sumNumber(
		conditional(
			isNotNull(jsonPath(column(review, "properties"), "rating")),
			literal(1),
			literal(0),
		),
	),

	averageRating: selectedMeasure(
		{ function: "average", expr: castNumber(jsonPath(column(review, "properties"), "rating")) },
		Schema.NullOr(Schema.Finite),
	),
});

export const mediaConsumptionReportRecipe = defineRecipe(
	(input: {
		now: number;
		timeZone: TimeZone;
		selection: ReportingSelection;
		entityId?: string | undefined;
		reference: PluginIdentityReference;
	}) => {
		const resolved = resolveReportingSelection(input.selection, {
			now: input.now,
			timeZone: input.timeZone,
		});
		const hour = consumptionDetail(input, "consumptionHour", resolved.current);
		const rank = consumptionDetail(input, "consumptionRanking", resolved.current);
		const trend = consumptionTrendSelection(input, resolved.current, resolved.grouping);
		const review = consumptionReviewSource(input, resolved.current);
		const attributionKind = (event: Table) =>
			castText(consumptionValue(event, "attribution", "kind"));
		const coverageEvent = table("event", "consumptionCoverageEvent");
		const coverageEntity = table("entity", "consumptionCoverageEntity");
		const emptyTotals = {
			titleCompletions: 0,
			episodeCompletions: 0,
			activeObservations: 0,
			...Object.fromEntries(
				consumptionMeasureUnits.flatMap((unit) =>
					["Recorded", "Estimated", "Missing"].map((field) => [`${unit}${field}`, 0]),
				),
			),
		};
		const totals = (alias: string, period: null | ReportingPeriod) => {
			const { event, joins, where, entity } = consumptionDetail(input, alias, period);
			return selectedAggregate(event, {
				joins,
				limit: 100,
				orderBy: [groupAscending("mediaType")],
				measures: consumptionMeasures(event, true),
				where,
				groupBy: { mediaType: selectedField(column(entity, "entitySchemaSlug"), Schema.String) },
			});
		};
		return {
			map: ({ trends, hourly, current, reviews, previous, rankings, coverage, activeWork }) => {
				const withCoverage = (quantities: typeof current) => ({
					...quantities,
					pageInfo: {
						...quantities.pageInfo,
						hasMore:
							(quantities.pageInfo?.hasMore ?? false) || (coverage.pageInfo?.hasMore ?? false),
					},
					items: coverage.items.map((row) => ({
						...emptyTotals,
						...quantities.items.find((item) => item.mediaType === row.mediaType),
						...row,
					})),
				});
				return Result.succeed({
					hourly,
					reviews,
					resolved,
					rankings,
					current: withCoverage(current),
					previous: previous === undefined ? null : withCoverage(previous),
					trends: {
						...trends,
						items: trends.items.map((row) => ({
							...row,
							at: localDateOf(row.at, row.precision === "date" ? UTC : input.timeZone),
						})),
					},
					processing: consumptionProcessingState(
						activeWork.items.length +
							coverage.items.reduce((total, row) => total + (row.pending ?? 0), 0),
						coverage.items.reduce((total, row) => total + (row.failed ?? 0), 0),
					),
				});
			},
			queries: {
				current: totals("currentConsumption", resolved.current),

				previous:
					resolved.previous === null ? undefined : totals("previousConsumption", resolved.previous),

				rankings: selectedAggregate(rank.event, {
					limit: 100,
					joins: rank.joins,
					where: rank.where,
					measures: consumptionMeasures(rank.event),
					orderBy: [measureDescending("activeObservations"), groupAscending("entityId")],
					groupBy: {
						name: selectedField(column(rank.entity, "name"), Schema.String),

						entityId: selectedField(column(rank.entity, "id"), Schema.String),

						mediaType: selectedField(column(rank.entity, "entitySchemaSlug"), Schema.String),
					},
				}),

				hourly: selectedAggregate(hour.event, {
					limit: 1000,
					joins: hour.joins,
					measures: consumptionMeasures(hour.event),
					orderBy: [groupAscending("hour"), groupAscending("mediaType")],
					where: and(hour.where, eq(attributionKind(hour.event), literal("instant"))),
					groupBy: {
						mediaType: selectedField(column(hour.entity, "entitySchemaSlug"), Schema.String),

						hour: selectedField(
							localHour(castDate(consumptionValue(hour.event, "attribution", "value")), {
								timeZone: input.timeZone,
							}),
							Schema.Finite,
						),
					},
				}),

				trends: selectedAggregate(trend.event, trend.selection),

				coverage: selectedAggregate(coverageEvent, {
					limit: 100,
					orderBy: [groupAscending("mediaType")],
					where: and(consumptionScope(coverageEvent, input), consumptionRows(coverageEvent)),
					groupBy: {
						mediaType: selectedField(column(coverageEntity, "entitySchemaSlug"), Schema.String),
					},
					joins: [
						join(
							"inner",
							coverageEntity,
							eq(column(coverageEntity, "id"), column(coverageEvent, "entityId")),
						),
					],
					measures: {
						pending: sumNumber(
							conditional(not(consumptionReady(coverageEvent)), literal(1), literal(0)),
						),
						failed: sumNumber(
							conditional(
								eq(column(coverageEvent, "projectionStatus"), literal("failed")),
								literal(1),
								literal(0),
							),
						),
						unknownDate: sumNumber(
							conditional(
								and(
									consumptionReady(coverageEvent),
									eq(
										castText(consumptionValue(coverageEvent, "attribution", "kind")),
										literal("unknown"),
									),
								),
								literal(1),
								literal(0),
							),
						),
					},
				}),

				activeWork: consumptionActiveWork(input.reference),

				reviews: selectedAggregate(review.review, {
					limit: 100,
					joins: review.joins,
					where: review.where,
					orderBy: [groupAscending("mediaType")],
					measures: consumptionReviewMeasures(review.review),
					groupBy: {
						mediaType: selectedField(column(review.entity, "entitySchemaSlug"), Schema.String),
					},
				}),
			},
		};
	},
);
