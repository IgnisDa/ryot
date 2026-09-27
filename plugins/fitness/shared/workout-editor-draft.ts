import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId, EventId, LocalAssetLocator, S3AssetLocator } from "@ryot-app/plugin-kit/schema";

import { exerciseKindSchema } from "./exercise-kinds";
import { decodeWorkoutEditorJson, encodeWorkoutEditorJson } from "./workout-editor-codec";
import { WorkoutEditorSaveInputSchema } from "./workout-editor-operations";
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
	sourceExerciseOrder: Schema.optional(nonNegativeNumber),
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
	exerciseId: nonEmptyEntityId,
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
	activeSetId: Schema.optional(nonEmptyString),
	caloriesBurnt: Schema.optional(Schema.String),
	kind: Schema.Literal("fitness-workout-editor"),
	stopwatchStartedAt: Schema.optional(timestamp),
	displayEnergyUnit: Schema.Literals(["kcal", "kJ"]),
	activeDuration: Schema.optional(nonNegativeNumber),
	activeDurationStartedAt: Schema.optional(timestamp),
	activeOccurrenceId: Schema.optional(nonEmptyString),
	supersets: Schema.Array(WorkoutEditorSupersetSchema),
	occurrences: Schema.Array(WorkoutEditorOccurrenceSchema),
	submission: Schema.optional(WorkoutEditorSaveInputSchema),
	pausedStopwatchSeconds: Schema.optional(nonNegativeNumber),
	restCountdown: Schema.optional(WorkoutEditorCountdownSchema),
	executionCountdown: Schema.optional(WorkoutEditorCountdownSchema),
	activeDurationIntent: Schema.Literals(["preserve", "set", "clear"]),
	localPreferences: Schema.optional(WorkoutEditorLocalPreferencesSchema),
	uploadedAssets: Schema.optional(Schema.Array(Schema.Union([LocalAssetLocator, S3AssetLocator]))),
	pendingRest: Schema.optional(
		Schema.Struct({
			setId: nonEmptyString,
			seconds: nonNegativeNumber,
			occurrenceId: nonEmptyString,
			exerciseId: nonEmptyEntityId,
		}),
	),
});

export type WorkoutEditorSet = typeof WorkoutEditorSetSchema.Type;
export type WorkoutEditorMode = typeof WorkoutEditorModeSchema.Type;
export type WorkoutEditorDraft = typeof WorkoutEditorDraftSchema.Type;
export type WorkoutEditorDisplay = typeof WorkoutEditorDisplaySchema.Type;
export type WorkoutEditorOccurrence = typeof WorkoutEditorOccurrenceSchema.Type;
export type WorkoutEditorLocalPreferences = typeof WorkoutEditorLocalPreferencesSchema.Type;

export const encodeWorkoutEditorDraft = (draft: WorkoutEditorDraft) =>
	encodeWorkoutEditorJson(JSON.stringify(Schema.encodeSync(WorkoutEditorDraftSchema)(draft)));

export const decodeWorkoutEditorDraft = (value: unknown) => {
	const decoded = decodeWorkoutEditorJson(value);
	return decoded._tag === "Failure"
		? decoded
		: Schema.decodeResult(Schema.fromJsonString(WorkoutEditorDraftSchema))(decoded.success);
};
