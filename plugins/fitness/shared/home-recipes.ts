import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	coalesce,
	column,
	conditional,
	defineRecipe,
	descending,
	entitySchemaPredicate,
	eq,
	first,
	groupAscending,
	gte,
	join,
	jsonArrayCount,
	jsonArrayExists,
	jsonPath,
	literal,
	type Recipe,
	relationshipSchemaPredicate,
	schemaOwnerPredicate,
	selectedAggregate,
	selectedField,
	selectedInclude,
	selectedMeasure,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import {
	entityIdentitySelection,
	projectionProperty,
	property,
	propertyDate,
	propertyJson,
	propertyNumber,
} from "./entity-selections";
import { exerciseKindSchema } from "./exercise-kinds";
import { effectiveTaxonomyLink } from "./taxonomy-recipes";
import { PersonalBestSchema } from "./workout-records";

type Reference = PluginIdentityReference;

const nullableNumber = Schema.NullOr(Schema.Finite);
const nullableString = Schema.NullOr(Schema.String);
const templateSlug = "workout-to-workout-template";
const MUSCLE_TARGET_LIMIT = 100;
const SECONDARY_WEIGHT = 0.5;

export const muscleActivityRecipe = defineRecipe(
	(input: { readonly reference: Reference; readonly weekStartAt: string }) => {
		const set = table("event", "muscleSet");
		const link = table("relationship", "muscleLink");
		const target = table("entity", "muscleTarget");
		return {
			map: ({ activity }) =>
				Result.succeed(
					activity.items
						.map((item) => ({ ...item, weeklySets: item.weeklySets ?? 0 }))
						.sort((left, right) => {
							if (left.lastTrainedAt === null || right.lastTrainedAt === null) {
								return (
									Number(right.lastTrainedAt === null) - Number(left.lastTrainedAt === null) ||
									left.name.localeCompare(right.name)
								);
							}
							return (
								Date.parse(left.lastTrainedAt) - Date.parse(right.lastTrainedAt) ||
								left.name.localeCompare(right.name)
							);
						}),
				),
			queries: {
				activity: selectedAggregate(target, {
					limit: MUSCLE_TARGET_LIMIT,
					orderBy: [groupAscending("name"), groupAscending("id")],
					where: entitySchemaPredicate(target, "exercise-target", input.reference),
					groupBy: {
						id: selectedField(column(target, "id"), Schema.String),
						name: selectedField(column(target, "name"), Schema.String),
					},
					joins: [
						join(
							"left",
							link,
							and(
								eq(column(link, "targetEntityId"), column(target, "id")),
								relationshipSchemaPredicate(link, "exercise-targets", input.reference),
								effectiveTaxonomyLink(link),
							),
						),
						join(
							"left",
							set,
							and(
								eq(column(set, "entityId"), column(link, "sourceEntityId")),
								schemaOwnerPredicate(set, "eventSchemaPluginId", input.reference),
								eq(column(set, "eventSchemaSlug"), literal("workout-set")),
							),
						),
					],
					measures: {
						lastTrainedAt: selectedMeasure(
							{ function: "maximum", expr: column(set, "occurredAt") },
							nullableString,
						),
						weeklySets: selectedMeasure(
							{
								function: "sum",
								expr: conditional(
									gte(column(set, "occurredAt"), castDate(literal(input.weekStartAt))),
									conditional(
										eq(property(link, "role"), literal("stabilizer")),
										literal(0),
										conditional(
											eq(property(link, "role"), literal("secondary")),
											literal(SECONDARY_WEIGHT),
											literal(1),
										),
									),
									literal(0),
								),
							},
							nullableNumber,
						),
					},
				}),
			},
		};
	},
);

const recentPersonalBestSelection = (
	set: ReturnType<typeof table>,
	exercise: ReturnType<typeof table>,
) => ({
	id: selectedField(column(set, "id"), Schema.String),
	exerciseId: selectedField(column(exercise, "id"), Schema.String),
	reps: selectedField(propertyNumber(set, "reps"), nullableNumber),
	occurredAt: selectedField(column(set, "occurredAt"), Schema.String),
	exerciseName: selectedField(column(exercise, "name"), Schema.String),
	weight: selectedField(propertyNumber(set, "weight"), nullableNumber),
	duration: selectedField(propertyNumber(set, "duration"), nullableNumber),
	distance: selectedField(propertyNumber(set, "distance"), nullableNumber),
	exerciseKind: selectedField(property(set, "exerciseKind"), exerciseKindSchema),
	personalBests: selectedField(
		projectionProperty(set, "personalBests"),
		Schema.Array(PersonalBestSchema),
	),
});

export const recentPersonalBestsRecipe = defineRecipe(
	(input: { readonly reference: Reference; readonly limit: number; readonly since: string }) => {
		const set = table("event", "recordSet");
		const exercise = table("entity", "recordExercise");
		const countedSet = table("event", "recordCountSet");
		const withRecords = (source: ReturnType<typeof table>) =>
			and(
				schemaOwnerPredicate(source, "eventSchemaPluginId", input.reference),
				eq(column(source, "eventSchemaSlug"), literal("workout-set")),
				jsonArrayExists(projectionProperty(source, "personalBests")),
			);
		return {
			map: ({ recent, recentCount }) =>
				Result.succeed({ items: recent.items, recentCount: recentCount.count }),
			queries: {
				recentCount: selectedAggregate(countedSet, {
					measures: { count: selectedMeasure({ function: "count" }, Schema.Finite) },
					where: and(
						withRecords(countedSet),
						gte(column(countedSet, "occurredAt"), castDate(literal(input.since))),
					),
				}),
				recent: selectedRows(set, {
					limit: input.limit,
					where: withRecords(set),
					selection: recentPersonalBestSelection(set, exercise),
					orderBy: [descending(column(set, "occurredAt")), descending(column(set, "id"))],
					joins: [join("inner", exercise, eq(column(set, "entityId"), column(exercise, "id")))],
				}),
			},
		};
	},
);

const epoch = castDate(literal("1970-01-01T00:00:00.000Z"));

const linkedTo = (link: ReturnType<typeof table>, workout: ReturnType<typeof table>) => [
	join("inner", workout, eq(column(link, "sourceEntityId"), column(workout, "id"))),
];

const TemplateExercisesSchema = Schema.Array(Schema.Struct({ exerciseId: Schema.String }));

export const homeTemplatesRecipe = defineRecipe(
	(input: { readonly reference: Reference; readonly limit: number }) => {
		const template = table("entity", "homeTemplate");
		const lastLink = table("relationship", "homeLastLink");
		const lastWorkout = table("entity", "homeLastWorkout");
		const latest = table("relationship", "homeLatestLink");
		const latestWorkout = table("entity", "homeLatestWorkout");
		const linkWhere = (link: ReturnType<typeof table>, workout: ReturnType<typeof table>) =>
			and(
				relationshipSchemaPredicate(link, templateSlug, input.reference),
				entitySchemaPredicate(workout, "workout", input.reference),
				eq(column(link, "targetEntityId"), column(template, "id")),
			);
		return {
			map: ({ templates }) =>
				Result.succeed(
					templates.items.map(({ exercises, lastWorkout: workouts, ...item }) => ({
						...item,
						lastWorkout: workouts.items[0] ?? null,
						exerciseIds: (exercises ?? []).map(({ exerciseId }) => exerciseId),
					})),
				),
			queries: {
				templates: selectedRows(template, {
					limit: input.limit,
					where: entitySchemaPredicate(template, "workout-template", input.reference),
					selection: {
						...entityIdentitySelection(template),
						exercises: selectedField(
							propertyJson(template, "exercises"),
							Schema.NullOr(TemplateExercisesSchema),
						),
						exerciseCount: selectedField(
							jsonArrayCount(jsonPath(column(template, "properties"), "exercises")),
							Schema.Finite,
						),
					},
					orderBy: [
						ascending(
							coalesce(
								first(latest, {
									joins: linkedTo(latest, latestWorkout),
									where: linkWhere(latest, latestWorkout),
									select: propertyDate(latestWorkout, "startedAt"),
									orderBy: [descending(propertyDate(latestWorkout, "startedAt"))],
								}),
								epoch,
							),
						),
						ascending(column(template, "name")),
						ascending(column(template, "id")),
					],
					include: {
						lastWorkout: selectedInclude(lastLink, {
							limit: 1,
							joins: linkedTo(lastLink, lastWorkout),
							where: linkWhere(lastLink, lastWorkout),
							orderBy: [
								descending(propertyDate(lastWorkout, "startedAt")),
								descending(column(lastWorkout, "id")),
							],
							selection: {
								endedAt: selectedField(propertyDate(lastWorkout, "endedAt"), nullableString),
								startedAt: selectedField(propertyDate(lastWorkout, "startedAt"), nullableString),
								activeDuration: selectedField(
									propertyNumber(lastWorkout, "activeDuration"),
									nullableNumber,
								),
							},
						}),
					},
				}),
			},
		};
	},
);

export type MuscleActivity = Recipe.Success<typeof muscleActivityRecipe>[number];
export type HomePersonalBest = Recipe.Success<typeof recentPersonalBestsRecipe>["items"][number];
export type HomeTemplate = Recipe.Success<typeof homeTemplatesRecipe>[number];
