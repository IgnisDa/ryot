import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	castBoolean,
	coalesce,
	column,
	conditional,
	defineRecipe,
	eq,
	groupAscending,
	inArray,
	join,
	literal,
	measureDescending,
	type Recipe,
	schemaOwnerPredicate,
	selectedAggregate,
	selectedField,
	selectedMeasure,
	table,
	withinPeriod,
} from "@ryot-app/plugin-kit/ryotql";
import {
	localDateOf,
	type PluginIdentityReference,
	type TimeZone,
} from "@ryot-app/plugin-kit/schema";

import { consumptionEventSlugs } from "./consumption-projection";
import {
	consumptionActiveDay,
	consumptionAmount,
	consumptionNumber,
	consumptionPeriod,
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

const sumOf = (expr: Parameters<typeof coalesce>[0]) =>
	selectedMeasure({ expr, function: "sum" }, Schema.NullOr(Schema.Finite));

const active = (event: Table) =>
	eq(castBoolean(consumptionValue(event, "activeObservation")), literal(true));

/** The home window covers 52 weeks back to a Monday: at most 370 local days. */
const DAY_LIMIT = 371;

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
		const consumed = (alias: string) => {
			const source = scoped(alias, consumptionEventSlugs);
			return { ...source, where: and(source.where, consumptionPeriod(source.event, period)) };
		};
		const figures = consumed("activityFigures");
		const days = consumed("activityDays");
		const types = consumed("activityTypes");
		const reviews = scoped("activityReviews", ["review"]);
		const typeSchema = table("entitySchema", "activityTypesSchema");
		return {
			map: ({ mediaTypes, days: dayRows, figures: totals, reviews: reviewed }) =>
				Result.succeed({
					days: dayRows.items,
					mediaTypes: mediaTypes.items,
					figures: {
						reviews: reviewed.reviews,
						minutes: totals.minutes ?? 0,
						finished: totals.finished ?? 0,
						minutesMissing: totals.minutesMissing ?? 0,
					},
				}),
			queries: {
				reviews: selectedAggregate(reviews.event, {
					joins: reviews.joins,
					measures: { reviews: selectedMeasure({ function: "count" }, Schema.Finite) },
					where: and(reviews.where, withinPeriod(column(reviews.event, "occurredAt"), period)),
				}),
				days: selectedAggregate(days.event, {
					limit: DAY_LIMIT,
					joins: days.joins,
					orderBy: [groupAscending("day")],
					where: and(days.where, active(days.event)),
					measures: { events: selectedMeasure({ function: "count" }, Schema.Finite) },
					groupBy: {
						day: selectedField(consumptionActiveDay(days.event, input.timeZone), Schema.String),
					},
				}),
				figures: selectedAggregate(figures.event, {
					joins: figures.joins,
					where: figures.where,
					measures: {
						minutes: sumOf(consumptionAmount(figures.event, "minutes")),
						finished: sumOf(
							coalesce(consumptionNumber(figures.event, "titleCompletions"), literal(0)),
						),
						minutesMissing: sumOf(
							conditional(
								eq(
									castBoolean(consumptionValue(figures.event, "minutes", "missing")),
									literal(true),
								),
								literal(1),
								literal(0),
							),
						),
					},
				}),
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
			},
		};
	},
);

export type MediaActivity = Recipe.Success<typeof mediaActivityRecipe>;
