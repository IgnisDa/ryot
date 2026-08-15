import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	castDate,
	coalesce,
	column,
	conditional,
	dateBucket,
	defineRecipe,
	eq,
	groupAscending,
	gte,
	inArray,
	IsoDateString,
	join,
	literal,
	lt,
	measureDescending,
	selectedAggregate,
	selectedField,
	selectedMeasure,
	table,
	type Recipe,
} from "@ryot-app/plugin-kit/ryotql";

import { propertyNumber, type Table } from "./entity-selections";
import {
	eventSlugIsOneOf,
	lifecycleEventSlugs,
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
	type ScalarExpression,
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
		Schema.NullOr(Schema.Number),
	);

/** A year of daily buckets, with room for a leap year and slack. */
const DAY_LIMIT = 400;

/**
 * Media activity between the `from` (inclusive) and `until` (exclusive) instants. `figures` counts
 * completions of builtin media (episodes excluded), their minutes (`timeSpent`, else the entity's
 * `runtime`, both minutes) and reviews. `days` counts progress and complete events per day in
 * `timeZone`, each day reported as the instant it starts. `mediaTypes` counts the same events per
 * builtin media type, with the type's schema name.
 */
export const mediaActivityRecipe = defineRecipe(
	(input: { readonly from: string; readonly until: string; readonly timeZone: string }) => {
		const scoped = (alias: string, eventSlugs: readonly string[]) => {
			const event = table("event", `${alias}Event`);
			const entity = table("entity", `${alias}Entity`);
			return {
				event,
				entity,
				joins: [join("inner", entity, eq(column(event, "entityId"), column(entity, "id")))],
				where: and(
					eventSlugIsOneOf(event, eventSlugs),
					slugIsOneOf(entity, activityEntitySlugs),
					gte(column(event, "occurredAt"), castDate(literal(input.from))),
					lt(column(event, "occurredAt"), castDate(literal(input.until))),
				),
			};
		};
		const figures = scoped("activityFigures", ["complete", "review"]);
		const isComplete = eq(column(figures.event, "eventSchemaSlug"), literal("complete"));
		const days = scoped("activityDays", lifecycleEventSlugs);
		const types = scoped("activityTypes", lifecycleEventSlugs);
		const typeSchema = table("entitySchema", "activityTypesSchema");
		return {
			map: ({ mediaTypes, days: dayRows, figures: totals }) =>
				Result.succeed({
					days: dayRows.items,
					mediaTypes: mediaTypes.items,
					figures: {
						minutes: totals.minutes ?? 0,
						reviews: totals.reviews ?? 0,
						finished: totals.finished ?? 0,
					},
				}),
			queries: {
				days: selectedAggregate(days.event, {
					limit: DAY_LIMIT,
					joins: days.joins,
					where: days.where,
					orderBy: [groupAscending("day")],
					measures: { events: selectedMeasure({ function: "count" }, Schema.Number) },
					groupBy: {
						day: selectedField(
							dateBucket(column(days.event, "occurredAt"), {
								bucket: "day",
								timeZone: input.timeZone,
							}),
							IsoDateString,
						),
					},
				}),
				mediaTypes: selectedAggregate(types.event, {
					where: types.where,
					limit: builtinMediaEntitySchemaSlugs.length,
					orderBy: [measureDescending("events"), groupAscending("slug")],
					measures: { events: selectedMeasure({ function: "count" }, Schema.Number) },
					joins: [
						...types.joins,
						join("inner", typeSchema, eq(column(typeSchema, "slug"), mediaTypeOf(types.entity))),
					],
					groupBy: {
						label: selectedField(column(typeSchema, "name"), Schema.String),
						slug: selectedField(
							mediaTypeOf(types.entity),
							Schema.Literals(builtinMediaEntitySchemaSlugs),
						),
					},
				}),
				figures: selectedAggregate(figures.event, {
					joins: figures.joins,
					where: figures.where,
					measures: {
						reviews: countWhen(eq(column(figures.event, "eventSchemaSlug"), literal("review"))),
						finished: countWhen(
							and(isComplete, slugIsOneOf(figures.entity, builtinMediaEntitySchemaSlugs)),
						),
						minutes: selectedMeasure(
							{
								function: "sum",
								expr: conditional(
									isComplete,
									coalesce(
										propertyNumber(figures.event, "timeSpent"),
										propertyNumber(figures.entity, "runtime"),
									),
									literal(null),
								),
							},
							Schema.NullOr(Schema.Number),
						),
					},
				}),
			},
		};
	},
);

export type MediaActivity = Recipe.Success<typeof mediaActivityRecipe>;
