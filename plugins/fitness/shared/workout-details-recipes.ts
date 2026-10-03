import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	coalesce,
	column,
	conditional,
	defineRecipe,
	descending,
	eq,
	exists,
	first,
	isNull,
	join,
	jsonPath,
	literal,
	lt,
	selectedField,
	selectedInclude,
	selectedOptionalRow,
	table,
	type Recipe,
} from "@ryot-app/plugin-kit/ryotql";
import { LocalAssetLocator, RemoteAssetLocator, S3AssetLocator } from "@ryot-app/plugin-kit/schema";

import {
	nullableEquals,
	property,
	propertyDate,
	propertyJson,
	propertyNumber,
} from "./entity-selections";
import { exerciseKindSchema } from "./exercise-kinds";
import { workoutSelection, workoutTemplateInclude } from "./query-recipes";
import { exerciseEquipmentInclude, exerciseTargetInclude } from "./taxonomy-recipes";
import { PersonalBestSchema } from "./workout-records";

type Table = ReturnType<typeof table>;

const includeLimit = 100;
const nullableNumber = Schema.NullOr(Schema.Finite);
const nullableString = Schema.NullOr(Schema.String);
const order = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const ExerciseNotesSchema = Schema.Array(
	Schema.Struct({ exerciseOrder: order, notes: Schema.Array(Schema.String) }),
);

const SupersetsSchema = Schema.Array(
	Schema.Struct({ color: Schema.String, exercises: Schema.Array(order) }),
);

const ImageLocatorsSchema = Schema.Array(
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
			eq(column(relationship, "relationshipSchemaSlug"), literal("workout-repeated-from")),
			eq(column(repeatedFrom, "entitySchemaSlug"), literal("workout")),
		),
	});
};

const setMeasurementsSelection = (set: Table) => ({
	reps: selectedField(propertyNumber(set, "reps"), nullableNumber),
	weight: selectedField(propertyNumber(set, "weight"), nullableNumber),
	volume: selectedField(propertyNumber(set, "volume"), nullableNumber),
	duration: selectedField(propertyNumber(set, "duration"), nullableNumber),
	distance: selectedField(propertyNumber(set, "distance"), nullableNumber),
	exerciseOrder: selectedField(propertyNumber(set, "exerciseOrder"), nullableNumber),
});

const setOrdering = (set: Table) =>
	[
		ascending(propertyNumber(set, "exerciseOrder")),
		ascending(propertyNumber(set, "setOrder")),
	] as const;

const recordStatus = (exercise: Table, set: Table) => {
	const stream = table("eventStream", "workoutSetStream");
	const work = table("eventStreamWork", "workoutSetWork");
	const streamPluginId = column(stream, "eventSchemaPluginId");
	const processing = first(work, {
		orderBy: [ascending(column(work, "id"))],
		joins: [join("inner", stream, eq(column(work, "id"), column(stream, "id")))],
		where: and(
			eq(column(stream, "entityId"), column(exercise, "id")),
			nullableEquals(streamPluginId, column(exercise, "entitySchemaPluginId")),
			nullableEquals(streamPluginId, column(set, "eventSchemaPluginId")),
			eq(column(stream, "eventSchemaSlug"), column(set, "eventSchemaSlug")),
		),
		select: conditional(
			eq(column(work, "status"), literal("failed")),
			literal("failed"),
			conditional(
				and(
					eq(column(work, "status"), literal("completed")),
					eq(column(work, "claimedRevision"), column(stream, "revision")),
				),
				literal("ready"),
				literal("pending"),
			),
		),
	});
	return coalesce(
		processing,
		conditional(
			isNull(jsonPath(column(set, "properties"), "personalBests")),
			literal("pending"),
			literal("ready"),
		),
	);
};

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
			eq(column(priorSet, "eventSchemaSlug"), literal("workout-set")),
			eq(column(priorWorkout, "entitySchemaSlug"), literal("workout")),
			lt(priorStartedAt, propertyDate(workout, "startedAt")),
		),
	});
};

const exercisesInclude = (workout: Table) => {
	const exercise = table("entity", "exercise");
	const currentSet = table("event", "currentWorkoutSet");
	const set = table("event", "workoutSet");
	const previousSet = table("event", "previousWorkoutSet");
	return selectedInclude(exercise, {
		limit: includeLimit,
		orderBy: [ascending(column(exercise, "id"))],
		where: and(
			eq(column(exercise, "entitySchemaSlug"), literal("exercise")),
			exists(currentSet, {
				where: and(
					eq(column(currentSet, "entityId"), column(exercise, "id")),
					eq(column(currentSet, "sessionEntityId"), column(workout, "id")),
					eq(column(currentSet, "eventSchemaSlug"), literal("workout-set")),
				),
			}),
		),
		selection: {
			id: selectedField(column(exercise, "id"), Schema.String),
			name: selectedField(column(exercise, "name"), Schema.String),
			kind: selectedField(property(exercise, "kind"), Schema.NullOr(exerciseKindSchema)),
			images: selectedField(propertyJson(exercise, "images"), Schema.NullOr(ImageLocatorsSchema)),
			previousWorkoutStartedAt: selectedField(
				priorSession(workout, exercise, "startedAt"),
				nullableString,
			),
		},
		include: {
			targets: exerciseTargetInclude(exercise),
			equipment: exerciseEquipmentInclude(exercise),
			previousSets: selectedInclude(previousSet, {
				limit: includeLimit,
				orderBy: setOrdering(previousSet),
				selection: setMeasurementsSelection(previousSet),
				where: and(
					eq(column(previousSet, "entityId"), column(exercise, "id")),
					eq(column(previousSet, "eventSchemaSlug"), literal("workout-set")),
					eq(
						column(previousSet, "sessionEntityId"),
						priorSession(workout, exercise, "sessionEntityId"),
					),
				),
			}),
			sets: selectedInclude(set, {
				limit: includeLimit,
				orderBy: setOrdering(set),
				where: and(
					eq(column(set, "entityId"), column(exercise, "id")),
					eq(column(set, "sessionEntityId"), column(workout, "id")),
					eq(column(set, "eventSchemaSlug"), literal("workout-set")),
				),
				selection: {
					...setMeasurementsSelection(set),
					id: selectedField(column(set, "id"), Schema.String),
					note: selectedField(property(set, "note"), nullableString),
					rpe: selectedField(propertyNumber(set, "rpe"), nullableNumber),
					setLot: selectedField(property(set, "setLot"), nullableString),
					oneRm: selectedField(propertyNumber(set, "oneRm"), nullableNumber),
					restTime: selectedField(propertyNumber(set, "restTime"), nullableNumber),
					setOrder: selectedField(propertyNumber(set, "setOrder"), nullableNumber),
					confirmedAt: selectedField(propertyDate(set, "confirmedAt"), nullableString),
					recordStatus: selectedField(
						recordStatus(exercise, set),
						Schema.Literals(["pending", "ready", "failed"]),
					),
					personalBests: selectedField(
						jsonPath(column(set, "properties"), "personalBests"),
						Schema.NullOr(Schema.Array(PersonalBestSchema)),
					),
				},
			}),
		},
	});
};

export const workoutDetailsRecipe = defineRecipe((input: { readonly workoutId: string }) => {
	const workout = table("entity", "workout");
	return {
		map: ({ workout: result }) => Result.succeed(result ?? null),
		queries: {
			workout: selectedOptionalRow(workout, {
				orderBy: [ascending(column(workout, "id"))],
				where: and(
					eq(column(workout, "id"), literal(input.workoutId)),
					eq(column(workout, "entitySchemaSlug"), literal("workout")),
				),
				include: {
					exercises: exercisesInclude(workout),
					repeatedFrom: repeatedFromInclude(workout),
					template: workoutTemplateInclude(workout, 1),
				},
				selection: {
					...workoutSelection(workout),
					supersets: selectedField(
						propertyJson(workout, "supersets"),
						Schema.NullOr(SupersetsSchema),
					),
					exerciseNotes: selectedField(
						propertyJson(workout, "exerciseNotes"),
						Schema.NullOr(ExerciseNotesSchema),
					),
				},
			}),
		},
	};
});

export type WorkoutDetails = NonNullable<Recipe.Success<typeof workoutDetailsRecipe>>;
