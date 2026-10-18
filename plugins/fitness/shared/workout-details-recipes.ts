import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	descending,
	entitySchemaPredicate,
	eq,
	exists,
	first,
	isNotNull,
	join,
	literal,
	lt,
	type Recipe,
	schemaOwnerPredicate,
	selectedField,
	selectedInclude,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { LocalAssetLocator, RemoteAssetLocator, S3AssetLocator } from "@ryot-app/plugin-kit/schema";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import {
	projectionNumber,
	projectionProperty,
	property,
	propertyDate,
	propertyJson,
	propertyNumber,
} from "./entity-selections";
import { exerciseKindSchema } from "./exercise-kinds";
import { workoutSelection, workoutTemplateInclude } from "./query-recipes";
import { exerciseEquipmentInclude, exerciseTargetInclude } from "./taxonomy-recipes";
import { PersonalBestSchema } from "./workout-records";
import { WorkoutSetLotSchema } from "./workout-set";
import { DurationUnitSchema } from "./workout-units";

type Table = ReturnType<typeof table>;

const nullableNumber = Schema.NullOr(Schema.Finite);
const nullableString = Schema.NullOr(Schema.String);
const order = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const ExerciseNotesSchema = Schema.Array(
	Schema.Struct({ exerciseOrder: order, notes: Schema.Array(Schema.String) }),
);

const SupersetsSchema = Schema.Array(
	Schema.Struct({ color: Schema.String, exercises: Schema.Array(order) }),
);

export const ImageLocatorsSchema = Schema.Array(
	Schema.Union([LocalAssetLocator, RemoteAssetLocator, S3AssetLocator]),
);

const repeatedFromInclude = (workout: Table) => {
	const relationship = table("relationship", "repeatedFromRelationship");
	const repeatedFrom = table("entity", "repeatedFrom");
	return selectedInclude(relationship, {
		limit: 1,
		selection: workoutSelection(repeatedFrom),
		orderBy: [ascending(column(relationship, "id"))],
		joins: [
			join(
				"inner",
				repeatedFrom,
				eq(column(relationship, "targetEntityId"), column(repeatedFrom, "id")),
			),
		],
		where: and(
			eq(column(relationship, "sourceEntityId"), column(workout, "id")),
			eq(
				column(relationship, "relationshipSchemaPluginId"),
				column(workout, "entitySchemaPluginId"),
			),
			eq(column(repeatedFrom, "entitySchemaPluginId"), column(workout, "entitySchemaPluginId")),
			eq(column(relationship, "relationshipSchemaSlug"), literal("workout-repeated-from")),
			eq(column(repeatedFrom, "entitySchemaSlug"), literal("workout")),
		),
	});
};

const setMeasurementsSelection = (set: Table) => ({
	reps: selectedField(propertyNumber(set, "reps"), nullableNumber),
	weight: selectedField(propertyNumber(set, "weight"), nullableNumber),
	volume: selectedField(projectionNumber(set, "volume"), nullableNumber),
	duration: selectedField(propertyNumber(set, "duration"), nullableNumber),
	distance: selectedField(propertyNumber(set, "distance"), nullableNumber),
	exerciseOrder: selectedField(propertyNumber(set, "exerciseOrder"), nullableNumber),
});

const setOrdering = (set: Table) =>
	[
		ascending(propertyNumber(set, "exerciseOrder")),
		ascending(propertyNumber(set, "setOrder")),
	] as const;

const recordStatus = (set: Table) => column(set, "projectionStatus");

const priorSession = (workout: Table, exercise: Table, pick: "sessionEntityId" | "startedAt") => {
	const priorSet = table("event", "priorWorkoutSet");
	const priorWorkout = table("entity", "priorWorkout");
	const priorStartedAt = propertyDate(priorWorkout, "startedAt");
	return first(priorSet, {
		select: pick === "startedAt" ? priorStartedAt : column(priorSet, "sessionEntityId"),
		orderBy: [descending(priorStartedAt), ascending(column(priorSet, "sessionEntityId"))],
		joins: [
			join(
				"inner",
				priorWorkout,
				eq(column(priorSet, "sessionEntityId"), column(priorWorkout, "id")),
			),
		],
		where: and(
			eq(column(priorSet, "entityId"), column(exercise, "id")),
			eq(column(priorSet, "eventSchemaPluginId"), column(workout, "entitySchemaPluginId")),
			eq(column(priorWorkout, "entitySchemaPluginId"), column(workout, "entitySchemaPluginId")),
			eq(column(priorSet, "eventSchemaSlug"), literal("workout-set")),
			eq(column(priorWorkout, "entitySchemaSlug"), literal("workout")),
			lt(priorStartedAt, propertyDate(workout, "startedAt")),
		),
	});
};

export const workoutDetailsExercisesRecipe = defineRecipe(
	(input: {
		readonly reference: PluginIdentityReference;
		readonly workoutId: string;
		readonly after?: string | undefined;
	}) => {
		const workout = table("entity", "workout");
		const exercise = table("entity", "exercise");
		const currentSet = table("event", "currentWorkoutSet");
		const membership = table("relationship", "detailExerciseMembership");
		return {
			map: ({ exercises }) => Result.succeed(exercises),
			queries: {
				exercises: selectedRows(exercise, {
					limit: 100,
					after: input.after,
					orderBy: [ascending(column(exercise, "id"))],
					include: {
						targets: exerciseTargetInclude(exercise),
						equipment: exerciseEquipmentInclude(exercise),
					},
					joins: [
						join(
							"inner",
							workout,
							and(
								entitySchemaPredicate(workout, "workout", input.reference),
								eq(column(workout, "id"), literal(input.workoutId)),
							),
						),
					],
					where: and(
						eq(column(exercise, "entitySchemaSlug"), literal("exercise")),
						eq(column(exercise, "entitySchemaPluginId"), column(workout, "entitySchemaPluginId")),
						exists(currentSet, {
							where: and(
								eq(column(currentSet, "entityId"), column(exercise, "id")),
								eq(
									column(currentSet, "eventSchemaPluginId"),
									column(workout, "entitySchemaPluginId"),
								),
								eq(column(currentSet, "sessionEntityId"), column(workout, "id")),
								eq(column(currentSet, "eventSchemaSlug"), literal("workout-set")),
							),
						}),
					),
					selection: {
						id: selectedField(column(exercise, "id"), Schema.String),
						name: selectedField(column(exercise, "name"), Schema.String),
						images: selectedField(
							propertyJson(exercise, "images"),
							Schema.NullOr(ImageLocatorsSchema),
						),
						previousWorkoutId: selectedField(
							priorSession(workout, exercise, "sessionEntityId"),
							nullableString,
						),
						previousWorkoutStartedAt: selectedField(
							priorSession(workout, exercise, "startedAt"),
							nullableString,
						),
						defaultDurationUnit: selectedField(
							first(membership, {
								orderBy: [ascending(column(membership, "id"))],
								select: property(membership, "defaultDurationUnit"),
								where: and(
									schemaOwnerPredicate(membership, "relationshipSchemaPluginId", input.reference),
									eq(column(membership, "relationshipSchemaSlug"), literal("in-fitness-library")),
									eq(column(membership, "sourceEntityId"), column(exercise, "id")),
									isNotNull(column(membership, "userId")),
								),
							}),
							Schema.NullOr(DurationUnitSchema),
						),
					},
				}),
			},
		};
	},
);

export const workoutDetailsSetsRecipe = defineRecipe(
	(input: {
		readonly reference: PluginIdentityReference;
		readonly workoutId: string;
		readonly exerciseId?: string | undefined;
		readonly after?: string | undefined;
	}) => {
		const set = table("event", "workoutSet");
		const exercise = table("entity", "exercise");
		return {
			map: ({ sets }) => Result.succeed(sets),
			queries: {
				sets: selectedRows(set, {
					limit: 100,
					after: input.after,
					orderBy: [...setOrdering(set), ascending(column(set, "id"))],
					joins: [join("inner", exercise, eq(column(set, "entityId"), column(exercise, "id")))],
					where: and(
						schemaOwnerPredicate(set, "eventSchemaPluginId", input.reference),
						entitySchemaPredicate(exercise, "exercise", input.reference),
						eq(column(set, "eventSchemaSlug"), literal("workout-set")),
						eq(column(set, "sessionEntityId"), literal(input.workoutId)),
						...(input.exerciseId === undefined
							? []
							: [eq(column(set, "entityId"), literal(input.exerciseId))]),
					),
					selection: {
						...setMeasurementsSelection(set),
						id: selectedField(column(set, "id"), Schema.String),
						note: selectedField(property(set, "note"), nullableString),
						rpe: selectedField(propertyNumber(set, "rpe"), nullableNumber),
						exerciseId: selectedField(column(set, "entityId"), Schema.String),
						oneRm: selectedField(projectionNumber(set, "oneRm"), nullableNumber),
						restTime: selectedField(propertyNumber(set, "restTime"), nullableNumber),
						setOrder: selectedField(propertyNumber(set, "setOrder"), nullableNumber),
						confirmedAt: selectedField(propertyDate(set, "confirmedAt"), nullableString),
						exerciseKind: selectedField(property(set, "exerciseKind"), exerciseKindSchema),
						setLot: selectedField(property(set, "setLot"), Schema.NullOr(WorkoutSetLotSchema)),
						recordStatus: selectedField(
							recordStatus(set),
							Schema.Literals(["pending", "ready", "failed"]),
						),
						personalBests: selectedField(
							projectionProperty(set, "personalBests"),
							Schema.NullOr(Schema.Array(PersonalBestSchema)),
						),
					},
				}),
			},
		};
	},
);

export const workoutDetailsRecipe = defineRecipe(
	(input: { readonly reference: PluginIdentityReference; readonly workoutId: string }) => {
		const workout = table("entity", "workout");
		return {
			map: ({ workout: result }) => Result.succeed(result ?? null),
			queries: {
				workout: selectedOptionalRow(workout, {
					orderBy: [ascending(column(workout, "id"))],
					include: {
						repeatedFrom: repeatedFromInclude(workout),
						template: workoutTemplateInclude(workout, 1),
					},
					where: and(
						eq(column(workout, "id"), literal(input.workoutId)),
						entitySchemaPredicate(workout, "workout", input.reference),
					),
					selection: {
						...workoutSelection(workout),
						activeDuration: selectedField(
							propertyNumber(workout, "activeDuration"),
							nullableNumber,
						),
						images: selectedField(
							propertyJson(workout, "images"),
							Schema.NullOr(ImageLocatorsSchema),
						),
						videos: selectedField(
							propertyJson(workout, "videos"),
							Schema.NullOr(ImageLocatorsSchema),
						),
						supersets: selectedField(
							propertyJson(workout, "supersets"),
							Schema.NullOr(SupersetsSchema),
						),
						exerciseNotes: selectedField(
							propertyJson(workout, "exerciseNotes"),
							Schema.NullOr(ExerciseNotesSchema),
						),
						exerciseMedia: selectedField(
							propertyJson(workout, "exerciseMedia"),
							Schema.NullOr(
								Schema.Array(
									Schema.Struct({
										exerciseOrder: order,
										images: ImageLocatorsSchema,
										videos: ImageLocatorsSchema,
									}),
								),
							),
						),
					},
				}),
			},
		};
	},
);

type DetailsSetPage = Recipe.Success<typeof workoutDetailsSetsRecipe>;
type DetailsExercise = Recipe.Success<typeof workoutDetailsExercisesRecipe>["items"][number];
export type WorkoutDetails = NonNullable<Recipe.Success<typeof workoutDetailsRecipe>> & {
	readonly exercises: {
		readonly items: ReadonlyArray<
			DetailsExercise & {
				readonly sets: Pick<DetailsSetPage, "items">;
				readonly previousSets: {
					readonly items: ReadonlyArray<
						Pick<
							DetailsSetPage["items"][number],
							"reps" | "weight" | "volume" | "duration" | "distance" | "exerciseOrder"
						>
					>;
				};
			}
		>;
	};
};
