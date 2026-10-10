import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId, EventId } from "@ryot-app/plugin-kit/schema";

import { exerciseKindSchema } from "./exercise-kinds";
import {
	IsoTimestamp,
	NonEmptyString,
	NonNegativeInt,
	NonNegativeNumber,
	Rpe,
	SubmissionEnvelope,
} from "./fitness-primitives";
import { WorkoutSetMeasurementsSchema } from "./workout-records";
import { WorkoutEditorMediaSchema, WorkoutSetLotSchema } from "./workout-set";

const nonEmptyEntityId = EntityId.pipe(Schema.check(Schema.isMinLength(1)));
const nonEmptyEventId = EventId.pipe(Schema.check(Schema.isMinLength(1)));

export const WorkoutEditorSaveMeasurementsSchema = WorkoutSetMeasurementsSchema.pipe(
	Schema.check(
		Schema.makeFilter(
			(measurements) =>
				([
					measurements.reps,
					measurements.weight,
					measurements.duration,
					measurements.distance,
				].every((value) => value === undefined || value >= 0) &&
					(measurements.reps === undefined || Number.isSafeInteger(measurements.reps))) ||
				"Measurements must be nonnegative and repetitions must be whole numbers",
		),
	),
);

const WorkoutEditorSaveSetSchema = Schema.Struct({
	occurredAt: IsoTimestamp,
	clientId: NonEmptyString,
	rpe: Schema.optional(Rpe),
	setLot: WorkoutSetLotSchema,
	exerciseKind: exerciseKindSchema,
	note: Schema.optional(Schema.String),
	eventId: Schema.optional(nonEmptyEventId),
	restTime: Schema.optional(NonNegativeInt),
	confirmedAt: Schema.optional(IsoTimestamp),
	restTimerStartedAt: Schema.optional(IsoTimestamp),
	measurements: WorkoutEditorSaveMeasurementsSchema,
});

const WorkoutEditorTemplateSetSchema = Schema.Struct({
	clientId: NonEmptyString,
	rpe: Schema.optional(Rpe),
	setLot: WorkoutSetLotSchema,
	note: Schema.optional(Schema.String),
	restTime: Schema.optional(NonNegativeInt),
	measurements: WorkoutEditorSaveMeasurementsSchema,
});

const WorkoutEditorSupersetSaveSchema = Schema.Struct({
	color: Schema.String,
	occurrenceIds: Schema.Array(NonEmptyString),
});

const WorkoutEditorWorkoutTargetSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("create"),
		templateId: Schema.optional(nonEmptyEntityId),
		repeatedFromId: Schema.optional(nonEmptyEntityId),
	}).check(
		Schema.makeFilter(
			(target) =>
				target.templateId === undefined ||
				target.repeatedFromId === undefined ||
				"Choose one workout source",
		),
	),
	Schema.Struct({
		entityId: nonEmptyEntityId,
		conflictToken: NonEmptyString,
		kind: Schema.Literal("update"),
	}),
]);

const WorkoutEditorTemplateTargetSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("create") }),
	Schema.Struct({
		entityId: nonEmptyEntityId,
		conflictToken: NonEmptyString,
		kind: Schema.Literal("update"),
	}),
]);

export const WorkoutActiveDurationChangeSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("preserve") }),
	Schema.Struct({ kind: Schema.Literal("clear") }),
	Schema.Struct({ seconds: NonNegativeInt, kind: Schema.Literal("set") }),
]);
export type WorkoutActiveDurationChange = typeof WorkoutActiveDurationChangeSchema.Type;

const saveOccurrence = <Sets extends Schema.Constraint>(set: Sets) =>
	Schema.Struct({
		sets: Schema.Array(set),
		clientId: NonEmptyString,
		exerciseId: nonEmptyEntityId,
		images: WorkoutEditorMediaSchema,
		videos: WorkoutEditorMediaSchema,
		notes: Schema.Array(Schema.String),
		sourceExerciseOrder: Schema.optional(NonNegativeInt),
	});

const WorkoutEditorWorkoutDataSchema = Schema.Struct({
	name: NonEmptyString,
	startedAt: IsoTimestamp,
	kind: Schema.Literal("workout"),
	images: WorkoutEditorMediaSchema,
	videos: WorkoutEditorMediaSchema,
	endedAt: Schema.optional(IsoTimestamp),
	comment: Schema.optional(Schema.String),
	target: WorkoutEditorWorkoutTargetSchema,
	activeDuration: WorkoutActiveDurationChangeSchema,
	caloriesBurnt: Schema.optional(NonNegativeNumber),
	supersets: Schema.Array(WorkoutEditorSupersetSaveSchema),
	occurrences: Schema.Array(saveOccurrence(WorkoutEditorSaveSetSchema)),
});

const WorkoutEditorTemplateDataSchema = Schema.Struct({
	name: NonEmptyString,
	images: WorkoutEditorMediaSchema,
	kind: Schema.Literal("template"),
	videos: WorkoutEditorMediaSchema,
	comment: Schema.optional(Schema.String),
	target: WorkoutEditorTemplateTargetSchema,
	supersets: Schema.Array(WorkoutEditorSupersetSaveSchema),
	occurrences: Schema.Array(saveOccurrence(WorkoutEditorTemplateSetSchema)),
});

export const WorkoutEditorSaveInputSchema = Schema.Struct({
	...SubmissionEnvelope.fields,
	data: Schema.Union([WorkoutEditorWorkoutDataSchema, WorkoutEditorTemplateDataSchema]),
});

export const WorkoutEditorSaveOutputSchema = Schema.Union([
	Schema.Struct({
		entityId: nonEmptyEntityId,
		kind: Schema.Literal("saved"),
		sets: Schema.Array(Schema.Struct({ eventId: nonEmptyEventId, clientId: NonEmptyString })),
	}),
	Schema.Struct({ kind: Schema.Literal("conflict") }),
	Schema.Struct({
		kind: Schema.Literal("invalid"),
		setId: Schema.optional(NonEmptyString),
		occurrenceId: Schema.optional(NonEmptyString),
		code: Schema.Literals([
			"duplicate-id",
			"invalid-source",
			"invalid-time",
			"missing-measurement",
			"unconfirmed-set",
			"unrelated-event",
			"invalid-measurement",
			"invalid-exercise-kind",
			"invalid-superset",
			"missing-exercise",
			"media-forbidden",
		]),
	}),
	Schema.Struct({ kind: Schema.Literal("pro-required") }),
]);

export type WorkoutEditorSaveInput = typeof WorkoutEditorSaveInputSchema.Type;
export type WorkoutEditorSaveOutput = typeof WorkoutEditorSaveOutputSchema.Type;
