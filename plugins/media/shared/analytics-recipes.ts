import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	castBoolean,
	castDate,
	castJson,
	castText,
	coalesce,
	column,
	conditional,
	contains,
	countAll,
	countIf,
	dateBucket,
	defineRecipe,
	descending,
	eq,
	groupAscending,
	gt,
	isNotNull,
	join,
	literal,
	localDate,
	localHour,
	measureDescending,
	not,
	NullableNumber,
	or,
	parameters,
	projectionProcessingState,
	projectionStatusMeasures,
	reportingGroupingExpression,
	reportingParameterFields,
	reportingParameters,
	reportingTimeZone,
	type ReportingWindow,
	reportingWindow,
	schemaOwnerPredicate,
	selectedAggregate,
	selectedField,
	selectedMeasure,
	selectedRow,
	selectedRows,
	sumOf,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";
import { REPORTING_BUCKET_LIMIT, UTC } from "@ryot-app/plugin-kit/schema";

import { ConsumptionBasis, MediaPosition, SourceProgress } from "./consumption";
import type { ConsumptionMeasureUnit } from "./consumption-allocation";
import { ConsumptionContribution } from "./consumption-projection";
import {
	consumptionActiveDay,
	consumptionDetail,
	consumptionNumber,
	consumptionRows,
	type ConsumptionScope,
	consumptionScope,
	consumptionScopeParameterFields,
	consumptionValue,
	mediaTypeJoin,
} from "./consumption-recipes";
import type { Table } from "./entity-selections";
import { reviewRating } from "./user-rating";

export type MediaAnalyticsInput = ConsumptionScope;
type MediaAnalyticsQueryInput = {
	readonly reference: PluginIdentityReference;
	readonly reporting: {
		readonly grouping: Parameters<typeof dateBucket>[1]["bucket"];
		readonly timeZone: Parameters<typeof dateBucket>[1]["timeZone"];
	};
};
const mediaTypeParameter = {
	type: "string",
	label: "Media type",
	description: "Restrict results to one kind of media",
} as const;
const mediaFilterParameters = parameters({ fields: { mediaType: mediaTypeParameter } });
export type MediaAnalyticsFilter = {
	readonly hour?: number;
	readonly mediaType?: string;
	readonly activeOnly?: boolean;
};

const flag = (event: Table, ...path: string[]) =>
	eq(castBoolean(consumptionValue(event, ...path)), literal(true));
const attributionKind = (event: Table) => castText(consumptionValue(event, "attribution", "kind"));
const attributedAt = (event: Table) => castDate(consumptionValue(event, "attribution", "value"));
const consumptionBucket = (event: Table, timeZone: Parameters<typeof dateBucket>[1]["timeZone"]) =>
	reportingGroupingExpression((bucket) =>
		conditional(
			eq(attributionKind(event), literal("date")),
			localDate(dateBucket(attributedAt(event), { bucket, timeZone: UTC }), { timeZone: UTC }),
			localDate(dateBucket(attributedAt(event), { bucket, timeZone }), { timeZone }),
		),
	);

const recorded = (event: Table, unit: ConsumptionMeasureUnit) =>
	sumOf(coalesce(consumptionNumber(event, unit, "recorded"), literal(0)));
const estimated = (event: Table, unit: ConsumptionMeasureUnit) =>
	sumOf(coalesce(consumptionNumber(event, unit, "estimated"), literal(0)));
const missing = (event: Table, unit: ConsumptionMeasureUnit) =>
	countIf(flag(event, unit, "missing"));
const superseded = (event: Table, unit: ConsumptionMeasureUnit) =>
	countIf(flag(event, unit, "supersededEstimate"));
const known = (event: Table, unit: ConsumptionMeasureUnit) =>
	countIf(
		and(
			isNotNull(consumptionValue(event, unit)),
			not(flag(event, unit, "missing")),
			not(flag(event, unit, "supersededEstimate")),
		),
	);

const completionMeasures = (event: Table) => ({
	activeObservations: countIf(flag(event, "activeObservation")),
	titleCompletions: sumOf(coalesce(consumptionNumber(event, "titleCompletions"), literal(0))),
	episodeCompletions: sumOf(coalesce(consumptionNumber(event, "episodeCompletions"), literal(0))),
});

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
	...completionMeasures(event),
});
const activeDays = (event: Table, timeZone: Parameters<typeof dateBucket>[1]["timeZone"]) =>
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
const periodSummary = (input: MediaAnalyticsQueryInput, period: ReportingWindow, alias: string) => {
	const source = consumptionDetail(input, `${alias}Consumption`, period);
	const type = mediaTypeJoin(source.entity, `${alias}Type`, input.reference);
	const review = table("event", `${alias}Review`);
	const reviewed = table("entity", `${alias}Reviewed`);
	const reviewType = mediaTypeJoin(reviewed, `${alias}ReviewType`, input.reference);
	return {
		activeDays: selectedAggregate(source.event, {
			joins: source.joins,
			where: source.where,
			measures: { activeDays: activeDays(source.event, input.reporting.timeZone) },
		}),
		types: selectedAggregate(source.event, {
			limit: 100,
			where: source.where,
			joins: [...source.joins, type.join],
			orderBy: [groupAscending("mediaType")],
			groupBy: { label: type.label, mediaType: type.slug },
			measures: {
				...consumptionMeasures(source.event),
				activeDays: activeDays(source.event, input.reporting.timeZone),
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
			measures: {
				reviews: countAll,
				rated: countIf(isNotNull(reviewRating(review))),
				averageRating: selectedMeasure(
					{ function: "average", expr: reviewRating(review) },
					NullableNumber,
				),
			},
			where: and(
				consumptionScope(review, input),
				schemaOwnerPredicate(reviewed, "entitySchemaPluginId", input.reference),
				eq(column(review, "eventSchemaSlug"), literal("review")),
				period.where(column(review, "occurredAt")),
			),
		}),
	};
};
const reportingSelection = (reference: PluginIdentityReference) => {
	const plugin = table("plugin", "reportingPlugin");
	return selectedRow(plugin, {
		where: schemaOwnerPredicate(plugin, "id", reference),
		selection: {
			range: selectedField(reportingParameters.value("range"), Schema.String),
			comparison: selectedField(reportingParameters.value("comparison"), Schema.String),
			consistency: selectedField(reportingParameters.value("consistency"), Schema.Boolean),
		},
	});
};
const hasComparison = (selection: {
	readonly range: string;
	readonly comparison: string;
	readonly consistency: boolean;
}) =>
	selection.comparison === "previous-period" &&
	selection.range !== "all-time" &&
	!selection.consistency;

export const mediaAnalyticsSummaryRecipe = (structural: {
	readonly reference: PluginIdentityReference;
}) => {
	const args = parameters({
		fields: { ...reportingParameterFields, ...consumptionScopeParameterFields },
	});
	const input = {
		reference: structural.reference,
		reporting: {
			timeZone: reportingTimeZone,
			current: reportingWindow("current"),
			previous: reportingWindow("previous"),
			grouping: reportingParameters.value("grouping"),
		},
	};
	const resolved = input.reporting;
	const current = periodSummary(input, resolved.current, "current");
	const previous = periodSummary(input, resolved.previous, "previous");
	const processing = table("event", "processingEvent");
	const undated = table("event", "undatedEvent");
	return defineRecipe({
		parameters: args.schema,
		map: (result) => {
			return Result.succeed({
				unknownDate: result.undated.count,
				processing: projectionProcessingState(result.processing),
				current: {
					types: result.currentTypes.items,
					reviews: result.currentReviews.items,
					activeDays: result.currentActiveDays.activeDays,
				},
				previous: hasComparison(result.selection)
					? {
							types: result.previousTypes.items,
							reviews: result.previousReviews.items,
							activeDays: result.previousActiveDays.activeDays,
						}
					: null,
			});
		},
		queries: {
			currentTypes: current.types,
			previousTypes: previous.types,
			currentReviews: current.reviews,
			previousReviews: previous.reviews,
			currentActiveDays: current.activeDays,
			previousActiveDays: previous.activeDays,
			selection: reportingSelection(structural.reference),
			processing: selectedAggregate(processing, {
				measures: projectionStatusMeasures(processing),
				where: and(consumptionScope(processing, input), consumptionRows(processing)),
			}),
			undated: selectedAggregate(undated, {
				measures: { count: countAll },
				where: and(
					consumptionScope(undated, input),
					consumptionRows(undated),
					contains(column(undated, "properties"), literal({ dateUnknown: true })),
				),
			}),
		},
	});
};
const filtered = (source: ReturnType<typeof consumptionDetail>) =>
	and(
		source.where,
		mediaFilterParameters.whenSet(
			"mediaType",
			eq(column(source.entity, "entitySchemaSlug"), mediaFilterParameters.value("mediaType")),
		),
	);
export const mediaAnalyticsTrendRecipe = (structural: {
	readonly reference: PluginIdentityReference;
}) => {
	const args = parameters({
		fields: {
			...reportingParameterFields,
			...consumptionScopeParameterFields,
			mediaType: mediaTypeParameter,
		},
	});
	const input = {
		reference: structural.reference,
		reporting: {
			timeZone: reportingTimeZone,
			current: reportingWindow("current"),
			previous: reportingWindow("previous"),
			grouping: reportingParameters.value("grouping"),
		},
	};
	const resolved = input.reporting;
	const trend = (period: ReportingWindow, alias: string) => {
		const source = consumptionDetail(input, alias, period);
		return selectedAggregate(source.event, {
			joins: source.joins,
			limit: REPORTING_BUCKET_LIMIT,
			orderBy: [groupAscending("at")],
			measures: consumptionMeasures(source.event),
			groupBy: {
				at: selectedField(consumptionBucket(source.event, input.reporting.timeZone), Schema.String),
			},
			where: and(
				filtered(source),
				isNotNull(consumptionActiveDay(source.event, input.reporting.timeZone)),
			),
		});
	};
	return defineRecipe({
		parameters: args.schema,
		queries: {
			current: trend(resolved.current, "trendCurrent"),
			selection: reportingSelection(structural.reference),
			previous: trend(resolved.previous, "trendPrevious"),
		},
		map: ({ current, previous, selection }) =>
			Result.succeed({
				current: { items: current.items },
				previous: hasComparison(selection) ? { items: previous.items } : null,
			}),
	});
};
export const mediaAnalyticsHoursRecipe = (structural: {
	readonly reference: PluginIdentityReference;
}) => {
	const args = parameters({
		fields: {
			...reportingParameterFields,
			...consumptionScopeParameterFields,
			mediaType: mediaTypeParameter,
		},
	});
	const input = {
		reference: structural.reference,
		reporting: {
			timeZone: reportingTimeZone,
			current: reportingWindow("current"),
			previous: reportingWindow("previous"),
			grouping: reportingParameters.value("grouping"),
		},
	};
	const period = input.reporting.current;
	const source = consumptionDetail(input, "analyticsHour", period);
	return defineRecipe({
		parameters: args.schema,
		map: ({ hourly }) => Result.succeed(hourly.items),
		queries: {
			hourly: selectedAggregate(source.event, {
				limit: 24,
				joins: source.joins,
				orderBy: [groupAscending("hour")],
				measures: consumptionMeasures(source.event),
				where: and(filtered(source), eq(attributionKind(source.event), literal("instant"))),
				groupBy: {
					hour: selectedField(
						localHour(attributedAt(source.event), { timeZone: input.reporting.timeZone }),
						Schema.Finite,
					),
				},
			}),
		},
	});
};
export const mediaAnalyticsRankingRecipe = (structural: {
	readonly reference: PluginIdentityReference;
}) => {
	const args = parameters({
		fields: {
			...reportingParameterFields,
			...consumptionScopeParameterFields,
			mediaType: mediaTypeParameter,
			rankingBy: {
				type: "enum",
				label: "Rank by",
				defaultValue: "activeObservations",
				description: "Order titles by activity entries or completions",
				choices: {
					kind: "static",
					values: [
						{ value: "activeObservations" },
						{ value: "titleCompletions" },
						{ value: "episodeCompletions" },
					],
				},
			},
		},
	});
	const input = {
		reference: structural.reference,
		reporting: {
			timeZone: reportingTimeZone,
			current: reportingWindow("current"),
			previous: reportingWindow("previous"),
			grouping: reportingParameters.value("grouping"),
		},
	};
	const period = input.reporting.current;
	const source = consumptionDetail(input, "analyticsRank", period);
	const type = mediaTypeJoin(source.entity, "analyticsRankType", input.reference);
	return defineRecipe({
		parameters: args.schema,
		map: ({ ranking }) => Result.succeed(ranking),
		queries: {
			ranking: selectedAggregate(source.event, {
				limit: 100,
				where: filtered(source),
				joins: [...source.joins, type.join],
				measures: completionMeasures(source.event),
				groupBy: {
					label: type.label,
					mediaType: type.slug,
					name: selectedField(column(source.entity, "name"), Schema.String),
					entityId: selectedField(column(source.event, "entityId"), Schema.String),
				},
				orderBy: args.choice("rankingBy", {
					titleCompletions: [measureDescending("titleCompletions"), groupAscending("entityId")],
					activeObservations: [measureDescending("activeObservations"), groupAscending("entityId")],
					episodeCompletions: [measureDescending("episodeCompletions"), groupAscending("entityId")],
				}),
			}),
		},
	});
};
export const MediaConsumptionFacts = Schema.Struct({
	position: Schema.optionalKey(MediaPosition),
	timeSpent: Schema.optionalKey(Schema.Finite),
	sourceRun: Schema.optionalKey(Schema.String),
	calendarDate: Schema.optionalKey(Schema.String),
	dateUnknown: Schema.optionalKey(Schema.Boolean),
	progressPages: Schema.optionalKey(Schema.Finite),
	completionKey: Schema.optionalKey(Schema.String),
	progressPercent: Schema.optionalKey(Schema.Finite),
	sourceProgress: Schema.optionalKey(SourceProgress),
	consumptionBasis: Schema.optionalKey(ConsumptionBasis),
	consumedOn: Schema.optionalKey(Schema.Array(Schema.String)),
});
export const mediaAnalyticsRecordsRecipe = (structural: {
	readonly reference: PluginIdentityReference;
}) => {
	const args = parameters({
		fields: {
			...reportingParameterFields,
			...consumptionScopeParameterFields,
			mediaType: mediaTypeParameter,
			activeOnly: {
				type: "boolean",
				defaultValue: false,
				label: "Active observations",
				description: "Include only active observations",
			},
			hour: {
				label: "Hour",
				type: "integer",
				validation: { minimum: 0, maximum: 23 },
				description: "Reporting-zone hour of timed activity",
			},
		},
	});
	const input = {
		reference: structural.reference,
		reporting: {
			timeZone: reportingTimeZone,
			current: reportingWindow("current"),
			previous: reportingWindow("previous"),
			grouping: reportingParameters.value("grouping"),
		},
	};
	const period = input.reporting.current;
	const source = consumptionDetail(input, "analyticsRecord", period);
	const type = mediaTypeJoin(source.entity, "analyticsRecordType", input.reference);
	const event = source.event;
	return defineRecipe({
		parameters: args.schema,
		map: ({ records }) => Result.succeed(records),
		queries: {
			records: selectedRows(event, {
				limit: 100,
				joins: [...source.joins, type.join],
				orderBy: [
					descending(column(event, "occurredAt")),
					descending(column(event, "orderCreatedAt")),
					descending(column(event, "orderKey")),
					descending(column(event, "id")),
				],
				where: and(
					filtered(source),
					or(eq(args.value("activeOnly"), literal(false)), flag(event, "activeObservation")),
					args.whenSet(
						"hour",
						and(
							eq(attributionKind(event), literal("instant")),
							eq(
								localHour(attributedAt(event), { timeZone: reportingTimeZone }),
								args.value("hour"),
							),
						),
					),
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
	});
};
