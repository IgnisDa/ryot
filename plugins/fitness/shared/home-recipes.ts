import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	castText,
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
	jsonElementsJoin,
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
import { PersonalBestSchema } from "./workout-records";
import { muscleRoleSetWeight, occurrenceSets } from "./workout-taxonomy-recipes";

type Reference = PluginIdentityReference;

const nullableNumber = Schema.NullOr(Schema.Finite);
const nullableString = Schema.NullOr(Schema.String);
const templateSlug = "workout-to-workout-template";
const MUSCLE_TARGET_LIMIT = 100;

export const muscleActivityRecipe = defineRecipe(
	(input: { readonly weekStartAt: string; readonly reference: Reference }) => {
		const target = table("entity", "muscleTarget");
		const link = table("event", "muscleOccurrence");
		const element = jsonElementsJoin("inner", "muscleTargetElement", propertyJson(link, "targets"));
		const set = table("event", "muscleSet");
		const workout = table("entity", "muscleWorkout");
		const startedAt = propertyDate(workout, "startedAt");
		return {
			map: ({ targets, activity }) => {
				const trained = new Map(activity.items.map((item) => [item.id, item]));
				return Result.succeed(
					targets.items
						.map((item) => ({
							...item,
							weeklySets: trained.get(item.id)?.weeklySets ?? 0,
							lastTrainedAt: trained.get(item.id)?.lastTrainedAt ?? null,
						}))
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
				);
			},
			queries: {
				targets: selectedRows(target, {
					limit: MUSCLE_TARGET_LIMIT,
					where: entitySchemaPredicate(target, "exercise-target", input.reference),
					orderBy: [ascending(column(target, "name")), ascending(column(target, "id"))],
					selection: {
						id: selectedField(column(target, "id"), Schema.String),
						name: selectedField(column(target, "name"), Schema.String),
					},
				}),
				activity: selectedAggregate(link, {
					limit: 1000,
					orderBy: [groupAscending("id")],
					groupBy: {
						id: selectedField(
							castText(jsonPath(column(element, "value"), "entityId")),
							Schema.String,
						),
					},
					where: and(
						schemaOwnerPredicate(link, "eventSchemaPluginId", input.reference),
						eq(column(link, "eventSchemaSlug"), literal("workout-exercise")),
					),
					joins: [
						element,
						join(
							"inner",
							workout,
							and(
								eq(column(workout, "id"), column(link, "sessionEntityId")),
								entitySchemaPredicate(workout, "workout", input.reference),
							),
						),
						join("inner", set, occurrenceSets(set, link)),
					],
					measures: {
						lastTrainedAt: selectedMeasure(
							{ expr: startedAt, function: "maximum" },
							nullableString,
						),
						weeklySets: selectedMeasure(
							{
								function: "sum",
								expr: conditional(
									gte(startedAt, castDate(literal(input.weekStartAt))),
									muscleRoleSetWeight(castText(jsonPath(column(element, "value"), "role"))),
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
	(input: { readonly limit: number; readonly since: string; readonly reference: Reference }) => {
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
	(input: { readonly limit: number; readonly reference: Reference }) => {
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

export type HomeTemplate = Recipe.Success<typeof homeTemplatesRecipe>[number];
export type MuscleActivity = Recipe.Success<typeof muscleActivityRecipe>[number];
export type HomePersonalBest = Recipe.Success<typeof recentPersonalBestsRecipe>["items"][number];
