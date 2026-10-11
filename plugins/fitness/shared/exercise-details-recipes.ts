import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	conditional,
	dateBucket,
	defineRecipe,
	descending,
	eq,
	exists,
	first,
	groupAscending,
	gte,
	isNotNull,
	IsoDateString,
	join,
	jsonArrayExists,
	jsonPath,
	literal,
	measureDescending,
	selectedAggregate,
	selectedField,
	selectedInclude,
	selectedMeasure,
	selectedOptionalRow,
	selectedRows,
	table,
	type Recipe,
	entitySchemaPredicate,
	schemaOwnerPredicate,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import {
	property,
	propertyDate,
	propertyJson,
	propertyNumber,
	workoutDatesSelection,
} from "./entity-selections";
import {
	exerciseForceSchema,
	exerciseKindSchema,
	exerciseLevelSchema,
	exerciseMechanicSchema,
} from "./exercise-kinds";
import { exerciseEquipmentInclude, exerciseTargetInclude } from "./taxonomy-recipes";
import { ExerciseNotesSchema, ImageLocatorsSchema } from "./workout-details-recipes";
import { membershipField, membershipPropertiesSchema } from "./workout-exercise-recipes";
import { PersonalBestSchema } from "./workout-records";
import { WorkoutSetLotSchema } from "./workout-set";

type Table = ReturnType<typeof table>;

const rowLimit = 100;
const nullableNumber = Schema.NullOr(Schema.Finite);
const nullableString = Schema.NullOr(Schema.String);

export const bestWeightRepThresholds = [1, 5, 8, 12, 30] as const;

const exerciseSets = (reference: PluginIdentityReference, set: Table, exerciseId: string) =>
	and(
		schemaOwnerPredicate(set, "eventSchemaPluginId", reference),
		eq(column(set, "entityId"), literal(exerciseId)),
		eq(column(set, "eventSchemaSlug"), literal("workout-set")),
	);

const setWorkoutJoin = (set: Table, workout: Table) =>
	join("inner", workout, eq(column(set, "sessionEntityId"), column(workout, "id")));

const workoutOf = (workout: Table) => ({
	workoutId: selectedField(column(workout, "id"), Schema.String),
	workoutName: selectedField(column(workout, "name"), Schema.String),
	workoutStartedAt: selectedField(propertyDate(workout, "startedAt"), nullableString),
});

const numberMeasure = (function_: "maximum" | "sum", expr: Parameters<typeof conditional>[1]) =>
	selectedMeasure({ expr, function: function_ }, nullableNumber);

const countWhen = (predicate: Parameters<typeof conditional>[0]) =>
	numberMeasure("sum", conditional(predicate, literal(1), literal(0)));

const bestWeightAtLeast = (set: Table, reps: number) =>
	numberMeasure(
		"maximum",
		conditional(
			gte(propertyNumber(set, "reps"), literal(reps)),
			propertyNumber(set, "weight"),
			literal(null),
		),
	);

const totalsQuery = (reference: PluginIdentityReference, exerciseId: string) => {
	const set = table("event", "totalsSet");
	const [one, five, eight, twelve, thirty] = bestWeightRepThresholds;
	return selectedAggregate(set, {
		where: exerciseSets(reference, set, exerciseId),
		measures: {
			weightForReps1: bestWeightAtLeast(set, one),
			weightForReps5: bestWeightAtLeast(set, five),
			weightForReps8: bestWeightAtLeast(set, eight),
			weightForReps12: bestWeightAtLeast(set, twelve),
			weightForReps30: bestWeightAtLeast(set, thirty),
			reps: numberMeasure("sum", propertyNumber(set, "reps")),
			sets: selectedMeasure({ function: "count" }, Schema.Finite),
			volume: numberMeasure("sum", propertyNumber(set, "volume")),
			duration: numberMeasure("sum", propertyNumber(set, "duration")),
			distance: numberMeasure("sum", propertyNumber(set, "distance")),
			warmUpSets: countWhen(eq(property(set, "setLot"), literal("warm_up"))),
			failureSets: countWhen(eq(property(set, "setLot"), literal("failure"))),
			lastAt: selectedMeasure(
				{ function: "maximum", expr: column(set, "occurredAt") },
				nullableString,
			),
			firstAt: selectedMeasure(
				{ function: "minimum", expr: column(set, "occurredAt") },
				nullableString,
			),
			sessions: selectedMeasure(
				{ function: "countDistinct", expr: column(set, "sessionEntityId") },
				Schema.Finite,
			),
		},
	});
};

const monthsQuery = (reference: PluginIdentityReference, exerciseId: string, timeZone: string) => {
	const set = table("event", "monthsSet");
	return selectedAggregate(set, {
		limit: 1000,
		orderBy: [groupAscending("month")],
		where: exerciseSets(reference, set, exerciseId),
		groupBy: {
			month: selectedField(
				dateBucket(column(set, "occurredAt"), { timeZone, bucket: "month" }),
				IsoDateString,
			),
		},
		measures: {
			reps: numberMeasure("sum", propertyNumber(set, "reps")),
			volume: numberMeasure("sum", propertyNumber(set, "volume")),
			maxReps: numberMeasure("maximum", propertyNumber(set, "reps")),
			maxPace: numberMeasure("maximum", propertyNumber(set, "pace")),
			duration: numberMeasure("sum", propertyNumber(set, "duration")),
			distance: numberMeasure("sum", propertyNumber(set, "distance")),
			maxOneRm: numberMeasure("maximum", propertyNumber(set, "oneRm")),
			maxWeight: numberMeasure("maximum", propertyNumber(set, "weight")),
			maxDuration: numberMeasure("maximum", propertyNumber(set, "duration")),
			sessions: selectedMeasure(
				{ function: "countDistinct", expr: column(set, "sessionEntityId") },
				Schema.Finite,
			),
		},
	});
};

const topWorkoutQuery = (reference: PluginIdentityReference, exerciseId: string) => {
	const set = table("event", "topWorkoutSet");
	const workout = table("entity", "topWorkout");
	return selectedAggregate(set, {
		limit: 1,
		joins: [setWorkoutJoin(set, workout)],
		orderBy: [measureDescending("sessions"), groupAscending("name")],
		groupBy: { name: selectedField(column(workout, "name"), Schema.String) },
		where: and(
			exerciseSets(reference, set, exerciseId),
			entitySchemaPredicate(workout, "workout", reference),
		),
		measures: {
			sessions: selectedMeasure(
				{ function: "countDistinct", expr: column(set, "sessionEntityId") },
				Schema.Finite,
			),
		},
	});
};

const personalBestsQuery = (reference: PluginIdentityReference, exerciseId: string) => {
	const set = table("event", "personalBestSet");
	const workout = table("entity", "personalBestWorkout");
	return selectedRows(set, {
		limit: rowLimit,
		joins: [setWorkoutJoin(set, workout)],
		orderBy: [
			descending(column(set, "occurredAt")),
			descending(propertyNumber(set, "setOrder")),
			descending(column(set, "id")),
		],
		where: and(
			exerciseSets(reference, set, exerciseId),
			entitySchemaPredicate(workout, "workout", reference),
			jsonArrayExists(jsonPath(column(set, "properties"), "personalBests")),
		),
		selection: {
			...workoutOf(workout),
			id: selectedField(column(set, "id"), Schema.String),
			reps: selectedField(propertyNumber(set, "reps"), nullableNumber),
			oneRm: selectedField(propertyNumber(set, "oneRm"), nullableNumber),
			occurredAt: selectedField(column(set, "occurredAt"), Schema.String),
			weight: selectedField(propertyNumber(set, "weight"), nullableNumber),
			volume: selectedField(propertyNumber(set, "volume"), nullableNumber),
			duration: selectedField(propertyNumber(set, "duration"), nullableNumber),
			distance: selectedField(propertyNumber(set, "distance"), nullableNumber),
			personalBests: selectedField(
				jsonPath(column(set, "properties"), "personalBests"),
				Schema.Array(PersonalBestSchema),
			),
		},
	});
};

const hasExerciseSets = (
	reference: PluginIdentityReference,
	workout: Table,
	set: Table,
	exerciseId: string,
) =>
	exists(set, {
		where: and(
			exerciseSets(reference, set, exerciseId),
			eq(column(set, "sessionEntityId"), column(workout, "id")),
		),
	});

const sessionsQuery = (reference: PluginIdentityReference, exerciseId: string) => {
	const workout = table("entity", "sessionWorkout");
	const existing = table("event", "sessionExistingSet");
	const set = table("event", "sessionSet");
	const startedAt = propertyDate(workout, "startedAt");
	return selectedRows(workout, {
		limit: 5,
		orderBy: [descending(startedAt), ascending(column(workout, "id"))],
		where: and(
			entitySchemaPredicate(workout, "workout", reference),
			hasExerciseSets(reference, workout, existing, exerciseId),
		),
		selection: {
			id: selectedField(column(workout, "id"), Schema.String),
			name: selectedField(column(workout, "name"), Schema.String),
			...workoutDatesSelection(workout),
		},
		include: {
			sets: selectedInclude(set, {
				limit: rowLimit,
				where: and(
					exerciseSets(reference, set, exerciseId),
					eq(column(set, "sessionEntityId"), column(workout, "id")),
				),
				orderBy: [
					ascending(propertyNumber(set, "exerciseOrder")),
					ascending(propertyNumber(set, "setOrder")),
					ascending(column(set, "id")),
				],
				selection: {
					id: selectedField(column(set, "id"), Schema.String),
					reps: selectedField(propertyNumber(set, "reps"), nullableNumber),
					weight: selectedField(propertyNumber(set, "weight"), nullableNumber),
					duration: selectedField(propertyNumber(set, "duration"), nullableNumber),
					distance: selectedField(propertyNumber(set, "distance"), nullableNumber),
					setOrder: selectedField(propertyNumber(set, "setOrder"), nullableNumber),
					setLot: selectedField(property(set, "setLot"), Schema.NullOr(WorkoutSetLotSchema)),
				},
			}),
		},
	});
};

const setNotesQuery = (reference: PluginIdentityReference, exerciseId: string) => {
	const set = table("event", "noteSet");
	const workout = table("entity", "noteWorkout");
	return selectedRows(set, {
		limit: 20,
		joins: [setWorkoutJoin(set, workout)],
		orderBy: [
			descending(column(set, "occurredAt")),
			descending(propertyNumber(set, "setOrder")),
			descending(column(set, "id")),
		],
		where: and(
			exerciseSets(reference, set, exerciseId),
			entitySchemaPredicate(workout, "workout", reference),
			isNotNull(property(set, "note")),
		),
		selection: {
			...workoutOf(workout),
			id: selectedField(column(set, "id"), Schema.String),
			note: selectedField(property(set, "note"), Schema.String),
			setOrder: selectedField(propertyNumber(set, "setOrder"), nullableNumber),
		},
	});
};

const workoutNotesQuery = (reference: PluginIdentityReference, exerciseId: string) => {
	const workout = table("entity", "notesWorkout");
	const existing = table("event", "notesExistingSet");
	const set = table("event", "notesSet");
	return selectedRows(workout, {
		limit: 20,
		orderBy: [descending(propertyDate(workout, "startedAt")), ascending(column(workout, "id"))],
		where: and(
			entitySchemaPredicate(workout, "workout", reference),
			isNotNull(propertyJson(workout, "exerciseNotes")),
			hasExerciseSets(reference, workout, existing, exerciseId),
		),
		selection: {
			id: selectedField(column(workout, "id"), Schema.String),
			name: selectedField(column(workout, "name"), Schema.String),
			startedAt: selectedField(propertyDate(workout, "startedAt"), nullableString),
			exerciseNotes: selectedField(
				propertyJson(workout, "exerciseNotes"),
				Schema.NullOr(ExerciseNotesSchema),
			),
			exerciseOrder: selectedField(
				first(set, {
					select: propertyNumber(set, "exerciseOrder"),
					orderBy: [ascending(propertyNumber(set, "setOrder")), ascending(column(set, "id"))],
					where: and(
						exerciseSets(reference, set, exerciseId),
						eq(column(set, "sessionEntityId"), column(workout, "id")),
					),
				}),
				nullableNumber,
			),
		},
	});
};

const notesQuery = (reference: PluginIdentityReference, exerciseId: string) => {
	const note = table("event", "exerciseNote");
	return selectedRows(note, {
		limit: rowLimit,
		orderBy: [descending(column(note, "occurredAt")), descending(column(note, "id"))],
		where: and(
			eq(column(note, "entityId"), literal(exerciseId)),
			schemaOwnerPredicate(note, "eventSchemaPluginId", reference),
			eq(column(note, "eventSchemaSlug"), literal("review")),
		),
		selection: {
			id: selectedField(column(note, "id"), Schema.String),
			text: selectedField(property(note, "text"), nullableString),
			updatedAt: selectedField(column(note, "updatedAt"), Schema.String),
			occurredAt: selectedField(column(note, "occurredAt"), Schema.String),
			rating: selectedField(propertyNumber(note, "rating"), nullableNumber),
		},
	});
};

const exerciseQuery = (reference: PluginIdentityReference, exerciseId: string) => {
	const exercise = table("entity", "exercise");
	return selectedOptionalRow(exercise, {
		orderBy: [ascending(column(exercise, "id"))],
		include: {
			targets: exerciseTargetInclude(exercise),
			equipment: exerciseEquipmentInclude(exercise),
		},
		where: and(
			eq(column(exercise, "id"), literal(exerciseId)),
			entitySchemaPredicate(exercise, "exercise", reference),
		),
		selection: {
			id: selectedField(column(exercise, "id"), Schema.String),
			name: selectedField(column(exercise, "name"), Schema.String),
			userId: selectedField(column(exercise, "userId"), nullableString),
			kind: selectedField(property(exercise, "kind"), Schema.NullOr(exerciseKindSchema)),
			force: selectedField(property(exercise, "force"), Schema.NullOr(exerciseForceSchema)),
			level: selectedField(property(exercise, "level"), Schema.NullOr(exerciseLevelSchema)),
			images: selectedField(propertyJson(exercise, "images"), Schema.NullOr(ImageLocatorsSchema)),
			mechanic: selectedField(
				property(exercise, "mechanic"),
				Schema.NullOr(exerciseMechanicSchema),
			),
			instructions: selectedField(
				propertyJson(exercise, "instructions"),
				Schema.NullOr(Schema.Array(Schema.String)),
			),
			membershipProperties: selectedField(
				membershipField(exercise, reference, "properties"),
				Schema.NullOr(membershipPropertiesSchema),
			),
		},
	});
};

export const exerciseDetailsRecipe = defineRecipe(
	(input: {
		readonly reference: PluginIdentityReference;
		readonly exerciseId: string;
		readonly timeZone: string;
	}) => ({
		map: ({
			notes,
			months,
			totals,
			exercise,
			sessions,
			setNotes,
			topWorkout,
			workoutNotes,
			personalBests,
		}) =>
			Result.succeed({
				totals,
				notes: notes.items,
				months: months.items,
				sessions: sessions.items,
				setNotes: setNotes.items,
				exercise: exercise ?? null,
				workoutNotes: workoutNotes.items,
				personalBests: personalBests.items,
				topWorkout: topWorkout.items[0] ?? null,
			}),
		queries: {
			notes: notesQuery(input.reference, input.exerciseId),
			totals: totalsQuery(input.reference, input.exerciseId),
			exercise: exerciseQuery(input.reference, input.exerciseId),
			sessions: sessionsQuery(input.reference, input.exerciseId),
			setNotes: setNotesQuery(input.reference, input.exerciseId),
			topWorkout: topWorkoutQuery(input.reference, input.exerciseId),
			workoutNotes: workoutNotesQuery(input.reference, input.exerciseId),
			personalBests: personalBestsQuery(input.reference, input.exerciseId),
			months: monthsQuery(input.reference, input.exerciseId, input.timeZone),
		},
	}),
);

export type ExerciseDetails = Recipe.Success<typeof exerciseDetailsRecipe>;
