import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	column,
	conditional,
	coalesce,
	defineRecipe,
	descending,
	eq,
	first,
	groupAscending,
	gte,
	isNull,
	jsonArrayCount,
	jsonPath,
	jsonArrayExists,
	join,
	literal,
	neq,
	or,
	selectedAggregate,
	selectedField,
	selectedInclude,
	selectedMeasure,
	selectedRows,
	table,
	type Recipe,
	entitySchemaPredicate,
	relationshipSchemaPredicate,
	schemaOwnerPredicate,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import {
	entityIdentitySelection,
	property,
	propertyDate,
	propertyJson,
	propertyNumber,
	projectionProperty,
} from "./entity-selections";
import { exerciseKindSchema } from "./exercise-kinds";
import { exerciseTargetRoleSchema } from "./taxonomy";
import { effectiveTaxonomyLink } from "./taxonomy-recipes";
import { PersonalBestSchema } from "./workout-records";

type Reference = PluginIdentityReference;

const nullableNumber = Schema.NullOr(Schema.Finite);
const nullableString = Schema.NullOr(Schema.String);
const templateSlug = "workout-to-workout-template";
const MUSCLE_TARGET_LIMIT = 100;
const SECONDARY_WEIGHT = 0.5;

export const combineMuscleActivity = (
	names: readonly string[],
	groups: readonly {
		readonly name: string;
		readonly sets: number | null;
		readonly lastAt: string | null;
		readonly role: typeof exerciseTargetRoleSchema.Type | null;
	}[],
) => {
	const activity = new Map<string, { weeklySets: number; lastTrainedAt: string | null }>(
		names.map((name) => [name, { weeklySets: 0, lastTrainedAt: null }]),
	);
	for (const group of groups) {
		const current = activity.get(group.name) ?? { weeklySets: 0, lastTrainedAt: null };
		const weight = group.role === "secondary" ? SECONDARY_WEIGHT : 1;
		activity.set(group.name, {
			weeklySets: current.weeklySets + (group.sets ?? 0) * weight,
			lastTrainedAt:
				group.lastAt !== null &&
				(current.lastTrainedAt === null ||
					Date.parse(group.lastAt) > Date.parse(current.lastTrainedAt))
					? group.lastAt
					: current.lastTrainedAt,
		});
	}
	return [...activity.entries()]
		.map(([name, { weeklySets, lastTrainedAt }]) => ({ name, weeklySets, lastTrainedAt }))
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
		});
};

export const muscleActivityRecipe = defineRecipe(
	(input: { readonly reference: Reference; readonly weekStartAt: string }) => {
		const set = table("event", "muscleSet");
		const link = table("relationship", "muscleLink");
		const target = table("entity", "muscleTarget");
		const names = table("entity", "muscleName");
		return {
			map: ({ groups, targets }) =>
				Result.succeed(
					combineMuscleActivity(
						targets.items.map(({ name }) => name),
						groups.items,
					),
				),
			queries: {
				targets: selectedRows(names, {
					limit: MUSCLE_TARGET_LIMIT,
					where: entitySchemaPredicate(names, "exercise-target", input.reference),
					selection: { name: selectedField(column(names, "name"), Schema.String) },
					orderBy: [ascending(column(names, "name")), ascending(column(names, "id"))],
				}),
				groups: selectedAggregate(set, {
					limit: 400,
					orderBy: [groupAscending("name"), groupAscending("role")],
					groupBy: {
						name: selectedField(column(target, "name"), Schema.String),
						role: selectedField(property(link, "role"), Schema.NullOr(exerciseTargetRoleSchema)),
					},
					joins: [
						join("inner", link, eq(column(link, "sourceEntityId"), column(set, "entityId"))),
						join("inner", target, eq(column(link, "targetEntityId"), column(target, "id"))),
					],
					measures: {
						lastAt: selectedMeasure(
							{ function: "maximum", expr: column(set, "occurredAt") },
							nullableString,
						),
						sets: selectedMeasure(
							{
								function: "sum",
								expr: conditional(
									gte(column(set, "occurredAt"), castDate(literal(input.weekStartAt))),
									literal(1),
									literal(0),
								),
							},
							nullableNumber,
						),
					},
					where: and(
						schemaOwnerPredicate(set, "eventSchemaPluginId", input.reference),
						eq(column(set, "eventSchemaSlug"), literal("workout-set")),
						relationshipSchemaPredicate(link, "exercise-targets", input.reference),
						entitySchemaPredicate(target, "exercise-target", input.reference),
						effectiveTaxonomyLink(link),
						or(isNull(property(link, "role")), neq(property(link, "role"), literal("stabilizer"))),
					),
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

export type MuscleActivity = ReturnType<typeof combineMuscleActivity>[number];
export type HomePersonalBest = Recipe.Success<typeof recentPersonalBestsRecipe>["items"][number];
export type HomeTemplate = Recipe.Success<typeof homeTemplatesRecipe>[number];
