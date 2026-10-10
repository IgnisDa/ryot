import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId, EventId } from "@ryot-app/plugin-kit/schema";

import { exerciseKindSchema } from "./exercise-kinds";
import { WorkoutSetMeasurementsSchema } from "./workout-records";
import { WorkoutEditorMediaSchema, WorkoutSetLotSchema } from "./workout-set";

const nonEmptyString = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((value) => value.trim().length > 0 || "Expected a nonblank value"),
	),
);
const nonEmptyEntityId = EntityId.pipe(Schema.check(Schema.isMinLength(1)));
const nonEmptyEventId = EventId.pipe(Schema.check(Schema.isMinLength(1)));
const nonNegativeInteger = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const timestamp = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter(
			(value) => Number.isFinite(Date.parse(value)) || "Expected a valid timestamp",
		),
	),
);

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
	occurredAt: timestamp,
	clientId: nonEmptyString,
	setLot: WorkoutSetLotSchema,
	exerciseKind: exerciseKindSchema,
	images: WorkoutEditorMediaSchema,
	videos: WorkoutEditorMediaSchema,
	note: Schema.optional(Schema.String),
	confirmedAt: Schema.optional(timestamp),
	eventId: Schema.optional(nonEmptyEventId),
	restTime: Schema.optional(nonNegativeInteger),
	restTimerStartedAt: Schema.optional(timestamp),
	measurements: WorkoutEditorSaveMeasurementsSchema,
	rpe: Schema.optional(
		Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 10 }))),
	),
});

const WorkoutEditorTemplateSetSchema = Schema.Struct({
	clientId: nonEmptyString,
	setLot: WorkoutSetLotSchema,
	note: Schema.optional(Schema.String),
	restTime: Schema.optional(nonNegativeInteger),
	measurements: WorkoutEditorSaveMeasurementsSchema,
	rpe: Schema.optional(
		Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 10 }))),
	),
});

const WorkoutEditorSupersetSaveSchema = Schema.Struct({
	color: Schema.String,
	occurrenceIds: Schema.Array(nonEmptyString),
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
		conflictToken: nonEmptyString,
		kind: Schema.Literal("update"),
	}),
]);

const WorkoutEditorTemplateTargetSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("create") }),
	Schema.Struct({
		entityId: nonEmptyEntityId,
		conflictToken: nonEmptyString,
		kind: Schema.Literal("update"),
	}),
]);

export const WorkoutActiveDurationChangeSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("preserve") }),
	Schema.Struct({ kind: Schema.Literal("clear") }),
	Schema.Struct({ kind: Schema.Literal("set"), seconds: nonNegativeInteger }),
]);
export type WorkoutActiveDurationChange = typeof WorkoutActiveDurationChangeSchema.Type;

const WorkoutEditorWorkoutDataSchema = Schema.Struct({
	name: nonEmptyString,
	startedAt: timestamp,
	kind: Schema.Literal("workout"),
	images: WorkoutEditorMediaSchema,
	videos: WorkoutEditorMediaSchema,
	endedAt: Schema.optional(timestamp),
	comment: Schema.optional(Schema.String),
	target: WorkoutEditorWorkoutTargetSchema,
	activeDuration: WorkoutActiveDurationChangeSchema,
	supersets: Schema.Array(WorkoutEditorSupersetSaveSchema),
	caloriesBurnt: Schema.optional(
		Schema.Finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
	),
	occurrences: Schema.Array(
		Schema.Struct({
			clientId: nonEmptyString,
			exerciseId: nonEmptyEntityId,
			notes: Schema.Array(Schema.String),
			sets: Schema.Array(WorkoutEditorSaveSetSchema),
			sourceExerciseOrder: Schema.optional(nonNegativeInteger),
		}),
	),
});

const WorkoutEditorTemplateDataSchema = Schema.Struct({
	name: nonEmptyString,
	images: WorkoutEditorMediaSchema,
	kind: Schema.Literal("template"),
	videos: WorkoutEditorMediaSchema,
	comment: Schema.optional(Schema.String),
	target: WorkoutEditorTemplateTargetSchema,
	supersets: Schema.Array(WorkoutEditorSupersetSaveSchema),
	occurrences: Schema.Array(
		Schema.Struct({
			clientId: nonEmptyString,
			exerciseId: nonEmptyEntityId,
			images: WorkoutEditorMediaSchema,
			videos: WorkoutEditorMediaSchema,
			notes: Schema.Array(Schema.String),
			sets: Schema.Array(WorkoutEditorTemplateSetSchema),
			sourceExerciseOrder: Schema.optional(nonNegativeInteger),
		}),
	),
});

export const WorkoutEditorSaveInputSchema = Schema.Struct({
	submittedAt: timestamp,
	submissionId: nonEmptyString.pipe(Schema.check(Schema.isMaxLength(96))),
	data: Schema.Union([WorkoutEditorWorkoutDataSchema, WorkoutEditorTemplateDataSchema]),
});

export const WorkoutEditorSaveOutputSchema = Schema.Union([
	Schema.Struct({
		entityId: nonEmptyEntityId,
		kind: Schema.Literal("saved"),
		sets: Schema.Array(Schema.Struct({ eventId: nonEmptyEventId, clientId: nonEmptyString })),
	}),
	Schema.Struct({
		entityId: nonEmptyEntityId,
		kind: Schema.Literal("incomplete"),
		committedSetIds: Schema.Array(nonEmptyString),
	}),
	Schema.Struct({ kind: Schema.Literal("conflict"), canEdit: Schema.optional(Schema.Boolean) }),
	Schema.Struct({
		kind: Schema.Literal("invalid"),
		setId: Schema.optional(nonEmptyString),
		canEdit: Schema.optional(Schema.Boolean),
		occurrenceId: Schema.optional(nonEmptyString),
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
	Schema.Struct({ kind: Schema.Literal("pro-required"), canEdit: Schema.optional(Schema.Boolean) }),
]);

export type WorkoutEditorSaveInput = typeof WorkoutEditorSaveInputSchema.Type;
export type WorkoutEditorSaveOutput = typeof WorkoutEditorSaveOutputSchema.Type;
