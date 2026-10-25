import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	castBoolean,
	castDate,
	castText,
	coalesce,
	column,
	conditional,
	dateBucket,
	defineRecipe,
	eq,
	groupAscending,
	gte,
	inArray,
	join,
	literal,
	lt,
	measureDescending,
	not,
	type Recipe,
	schemaOwnerPredicate,
	selectedAggregate,
	selectedField,
	selectedMeasure,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import {
	localDateOf,
	type PluginIdentityReference,
	type ReportingPeriod,
	type TimeZone,
} from "@ryot-app/plugin-kit/schema";

import { consumptionEventSlugs, consumptionProcessingState } from "./consumption-projection";
import {
	consumptionActiveWork,
	consumptionAmount,
	consumptionNumber,
	consumptionPeriod,
	consumptionReady,
	consumptionValue,
} from "./consumption-recipes";
import type { Table } from "./entity-selections";
import {
	eventSlugIsOneOf,
	podcastEpisodicKindConfig,
	type ScalarExpression,
	showEpisodicKindConfig,
} from "./lifecycle-expressions";
import { builtinMediaEntitySchemaSlugs } from "./media-schema-slugs";

const episodicKindConfigs = [showEpisodicKindConfig, podcastEpisodicKindConfig] as const;

const activityEntitySlugs = [
	...builtinMediaEntitySchemaSlugs,
	...episodicKindConfigs.map((config) => config.episodeSchemaSlug),
];

const slugIsOneOf = (entity: Table, slugs: readonly string[]) =>
	inArray(
		column(entity, "entitySchemaSlug"),
		slugs.map((slug) => literal(slug)),
	);

/** The builtin media type an activity entity counts toward: an episode counts toward its parent. */
const mediaTypeOf = (entity: Table) =>
	episodicKindConfigs.reduceRight<ScalarExpression>(
		(otherwise, config) =>
			conditional(
				eq(column(entity, "entitySchemaSlug"), literal(config.episodeSchemaSlug)),
				literal(config.parentSchemaSlug),
				otherwise,
			),
		column(entity, "entitySchemaSlug"),
	);

const countWhen = (predicate: Parameters<typeof conditional>[0]) =>
	selectedMeasure(
		{ function: "sum", expr: conditional(predicate, literal(1), literal(0)) },
		Schema.NullOr(Schema.Finite),
	);

/** A year of daily buckets, with room for a leap year and slack. */
const DAY_LIMIT = 400;

export const consumptionActive = (event: Table, period: null | ReportingPeriod) =>
	and(
		consumptionPeriod(event, period),
		eq(castBoolean(consumptionValue(event, "activeObservation")), literal(true)),
	);

export const consumptionDailySelection = (
	source: {
		readonly event: Table;
		readonly where: ReturnType<typeof and>;
		readonly joins: readonly ReturnType<typeof join>[];
	},
	kind: "date" | "instant",
	input: { readonly timeZone: TimeZone; readonly period: null | ReportingPeriod },
) =>
	selectedAggregate(source.event, {
		limit: DAY_LIMIT,
		joins: source.joins,
		orderBy: [groupAscending("day")],
		measures: { events: selectedMeasure({ function: "count" }, Schema.Finite) },
		where: and(
			source.where,
			consumptionActive(source.event, input.period),
			eq(castText(consumptionValue(source.event, "attribution", "kind")), literal(kind)),
		),
		groupBy: {
			day: selectedField(
				kind === "date"
					? castText(consumptionValue(source.event, "attribution", "value"))
					: dateBucket(castDate(consumptionValue(source.event, "attribution", "value")), {
							bucket: "day",
							timeZone: input.timeZone,
						}),
				Schema.String,
			),
		},
	});

export const mediaActivityRecipe = defineRecipe(
	(input: {
		readonly from: string;
		readonly until: string;
		readonly timeZone: TimeZone;
		readonly reference: PluginIdentityReference;
	}) => {
		const period = {
			endAt: input.until,
			startAt: input.from,
			startDate: localDateOf(input.from, input.timeZone),
			endDate: localDateOf(Date.parse(input.until) - 1, input.timeZone),
		};
		const scoped = (alias: string, eventSlugs: readonly string[]) => {
			const event = table("event", `${alias}Event`);
			const entity = table("entity", `${alias}Entity`);
			return {
				event,
				entity,
				joins: [join("inner", entity, eq(column(event, "entityId"), column(entity, "id")))],
				where: and(
					schemaOwnerPredicate(entity, "entitySchemaPluginId", input.reference),
					schemaOwnerPredicate(event, "eventSchemaPluginId", input.reference),
					eventSlugIsOneOf(event, eventSlugs),
					slugIsOneOf(entity, activityEntitySlugs),
				),
			};
		};
		const figures = scoped("activityFigures", [...consumptionEventSlugs, "review"]);
		const days = scoped("activityDays", consumptionEventSlugs);
		const dates = scoped("activityDates", consumptionEventSlugs);
		const types = scoped("activityTypes", consumptionEventSlugs);
		const active = (event: Table) => consumptionActive(event, period);
		const dayQuery = (source: typeof days, kind: "date" | "instant") =>
			consumptionDailySelection(source, kind, { period, timeZone: input.timeZone });
		const typeSchema = table("entitySchema", "activityTypesSchema");
		return {
			map: ({ mediaTypes, days: dayRows, dates: dateRows, figures: totals, activeWork }) => {
				const counts = new Map<string, number>();
				for (const row of [
					...dayRows.items.map((bucket) => ({
						events: bucket.events,
						day: localDateOf(bucket.day, input.timeZone),
					})),
					...dateRows.items,
				]) {
					counts.set(row.day, (counts.get(row.day) ?? 0) + row.events);
				}
				return Result.succeed({
					mediaTypes: mediaTypes.items,
					days: Array.from(counts, ([day, events]) => ({ day, events })),
					processing: consumptionProcessingState(
						activeWork.items.length + (totals.pending ?? 0),
						totals.failed ?? 0,
					),
					figures: {
						minutes: totals.minutes ?? 0,
						reviews: totals.reviews ?? 0,
						finished: totals.finished ?? 0,
						minutesMissing: totals.minutesMissing ?? 0,
					},
				});
			},
			queries: {
				activeWork: consumptionActiveWork(input.reference),
				dates: dayQuery(dates, "date"),
				days: dayQuery(days, "instant"),
				mediaTypes: selectedAggregate(types.event, {
					limit: builtinMediaEntitySchemaSlugs.length,
					where: and(types.where, active(types.event)),
					orderBy: [measureDescending("events"), groupAscending("slug")],
					measures: { events: selectedMeasure({ function: "count" }, Schema.Finite) },
					groupBy: {
						label: selectedField(column(typeSchema, "name"), Schema.String),
						slug: selectedField(
							mediaTypeOf(types.entity),
							Schema.Literals(builtinMediaEntitySchemaSlugs),
						),
					},
					joins: [
						...types.joins,
						join(
							"inner",
							typeSchema,
							and(
								eq(column(typeSchema, "slug"), mediaTypeOf(types.entity)),
								schemaOwnerPredicate(typeSchema, "pluginId", input.reference),
							),
						),
					],
				}),
				figures: selectedAggregate(figures.event, {
					joins: figures.joins,
					where: figures.where,
					measures: {
						failed: countWhen(eq(column(figures.event, "projectionStatus"), literal("failed"))),
						pending: countWhen(
							and(
								eventSlugIsOneOf(figures.event, consumptionEventSlugs),
								not(consumptionReady(figures.event)),
							),
						),
						minutesMissing: countWhen(
							and(
								consumptionPeriod(figures.event, period),
								eq(
									castBoolean(consumptionValue(figures.event, "minutes", "missing")),
									literal(true),
								),
							),
						),
						minutes: selectedMeasure(
							{
								function: "sum",
								expr: conditional(
									consumptionPeriod(figures.event, period),
									consumptionAmount(figures.event, "minutes"),
									literal(null),
								),
							},
							Schema.NullOr(Schema.Finite),
						),
						reviews: countWhen(
							and(
								eq(column(figures.event, "eventSchemaSlug"), literal("review")),
								gte(column(figures.event, "occurredAt"), castDate(literal(input.from))),
								lt(column(figures.event, "occurredAt"), castDate(literal(input.until))),
							),
						),
						finished: selectedMeasure(
							{
								function: "sum",
								expr: conditional(
									consumptionPeriod(figures.event, period),
									coalesce(consumptionNumber(figures.event, "titleCompletions"), literal(0)),
									literal(0),
								),
							},
							Schema.NullOr(Schema.Finite),
						),
					},
				}),
			},
		};
	},
);

export type MediaActivity = Recipe.Success<typeof mediaActivityRecipe>;
