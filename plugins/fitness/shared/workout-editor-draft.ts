import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId, EventId } from "@ryot-app/plugin-kit/schema";

import { exerciseKindSchema } from "./exercise-kinds";
import { WorkoutEditorMediaSchema, WorkoutSetLotSchema } from "./workout-set";

const nonEmptyString = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
const nonEmptyEntityId = EntityId.pipe(Schema.check(Schema.isMinLength(1)));
const nonEmptyEventId = EventId.pipe(Schema.check(Schema.isMinLength(1)));
const nonNegativeNumber = Schema.Finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const timestamp = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter(
			(value) => Number.isFinite(Date.parse(value)) || "Expected a valid timestamp",
		),
	),
);

export const WorkoutEditorSourceSchema = Schema.Union([
	Schema.Struct({ entityId: nonEmptyEntityId, kind: Schema.Literal("template") }),
	Schema.Struct({ entityId: nonEmptyEntityId, kind: Schema.Literal("repeat") }),
]);

export const WorkoutEditorModeSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("live"),
		source: Schema.optional(WorkoutEditorSourceSchema),
	}),
	Schema.Struct({
		entityId: nonEmptyEntityId,
		conflictToken: nonEmptyString,
		kind: Schema.Literal("historical"),
	}),
	Schema.Struct({
		kind: Schema.Literal("template-create"),
		sourceWorkoutId: Schema.optional(nonEmptyEntityId),
	}),
	Schema.Struct({
		entityId: nonEmptyEntityId,
		conflictToken: nonEmptyString,
		kind: Schema.Literal("template-edit"),
	}),
]);

export const WorkoutEditorDisplaySchema = Schema.Struct({
	weightUnit: Schema.Literals(["kg", "lb"]),
	distanceUnit: Schema.Literals(["km", "mi"]),
	durationUnit: Schema.Literals(["seconds", "minutes"]),
});

export const WorkoutEditorLocalPreferencesSchema = Schema.Struct({
	muteSounds: Schema.optional(Schema.Boolean),
	promptForRestTimer: Schema.optional(Schema.Boolean),
	startTimerForDurationExercises: Schema.optional(Schema.Boolean),
});

export const WorkoutEditorRestChoiceSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("inherited") }),
	Schema.Struct({ seconds: Schema.String, kind: Schema.Literal("explicit") }),
]);

export const WorkoutEditorSetSchema = Schema.Struct({
	clientId: nonEmptyString,
	included: Schema.Boolean,
	setLot: WorkoutSetLotSchema,
	exerciseKind: exerciseKindSchema,
	images: WorkoutEditorMediaSchema,
	videos: WorkoutEditorMediaSchema,
	rpe: Schema.optional(Schema.String),
	note: Schema.optional(Schema.String),
	reps: Schema.optional(Schema.String),
	occurredAt: Schema.optional(timestamp),
	weight: Schema.optional(Schema.String),
	confirmedAt: Schema.optional(timestamp),
	distance: Schema.optional(Schema.String),
	duration: Schema.optional(Schema.String),
	eventId: Schema.optional(nonEmptyEventId),
	restChoice: WorkoutEditorRestChoiceSchema,
	restTimerStartedAt: Schema.optional(timestamp),
});

export const WorkoutEditorOccurrenceSchema = Schema.Struct({
	clientId: nonEmptyString,
	isCollapsed: Schema.Boolean,
	exerciseId: nonEmptyEntityId,
	exerciseKind: exerciseKindSchema,
	images: WorkoutEditorMediaSchema,
	videos: WorkoutEditorMediaSchema,
	notes: Schema.Array(Schema.String),
	sets: Schema.Array(WorkoutEditorSetSchema),
	display: Schema.optional(WorkoutEditorDisplaySchema),
});

export const WorkoutEditorSupersetSchema = Schema.Struct({
	color: Schema.String,
	clientId: nonEmptyString,
	occurrenceIds: Schema.Array(nonEmptyString),
});

export const WorkoutEditorCountdownSchema = Schema.Struct({
	deadline: timestamp,
	setId: nonEmptyString,
	clientId: nonEmptyString,
	occurrenceId: nonEmptyString,
	durationSeconds: nonNegativeNumber,
	pausedRemainingSeconds: Schema.optional(nonNegativeNumber),
});

export const WorkoutEditorDraftSchema = Schema.Struct({
	name: Schema.String,
	draftId: nonEmptyString,
	mode: WorkoutEditorModeSchema,
	images: WorkoutEditorMediaSchema,
	videos: WorkoutEditorMediaSchema,
	endedAt: Schema.optional(timestamp),
	startedAt: Schema.optional(timestamp),
	comment: Schema.optional(Schema.String),
	caloriesBurnt: Schema.optional(Schema.String),
	kind: Schema.Literal("fitness-workout-editor"),
	stopwatchStartedAt: Schema.optional(timestamp),
	displayEnergyUnit: Schema.Literals(["kcal", "kJ"]),
	activeDuration: Schema.optional(nonNegativeNumber),
	activeDurationStartedAt: Schema.optional(timestamp),
	supersets: Schema.Array(WorkoutEditorSupersetSchema),
	occurrences: Schema.Array(WorkoutEditorOccurrenceSchema),
	pausedStopwatchSeconds: Schema.optional(nonNegativeNumber),
	restCountdown: Schema.optional(WorkoutEditorCountdownSchema),
	executionCountdown: Schema.optional(WorkoutEditorCountdownSchema),
	activeDurationIntent: Schema.Literals(["preserve", "set", "clear"]),
	localPreferences: Schema.optional(WorkoutEditorLocalPreferencesSchema),
	submission: Schema.optional(Schema.Struct({ id: nonEmptyString, submittedAt: timestamp })),
});

export type WorkoutEditorDraft = typeof WorkoutEditorDraftSchema.Type;
export type WorkoutEditorDisplay = typeof WorkoutEditorDisplaySchema.Type;
export type WorkoutEditorLocalPreferences = typeof WorkoutEditorLocalPreferencesSchema.Type;
export type WorkoutEditorMode = typeof WorkoutEditorModeSchema.Type;
export type WorkoutEditorOccurrence = typeof WorkoutEditorOccurrenceSchema.Type;
export type WorkoutEditorSet = typeof WorkoutEditorSetSchema.Type;
