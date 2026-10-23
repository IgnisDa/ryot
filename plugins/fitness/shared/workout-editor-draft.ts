import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId, EventId, LocalAssetLocator, S3AssetLocator } from "@ryot-app/plugin-kit/schema";

import { exerciseKindSchema } from "./exercise-kinds";
import { IsoTimestamp, NonEmptyString, NonNegativeNumber } from "./fitness-primitives";
import { SupersetColorSchema } from "./superset-colors";
import { decodeWorkoutEditorJson, encodeWorkoutEditorJson } from "./workout-editor-codec";
import { WorkoutEditorSaveInputSchema } from "./workout-editor-operations";
import { WorkoutEditorMediaSchema, WorkoutSetLotSchema } from "./workout-set";
import { DurationUnitSchema, EnergyUnitSchema } from "./workout-units";

const nonEmptyEntityId = EntityId.pipe(Schema.check(Schema.isMinLength(1)));
const nonEmptyEventId = EventId.pipe(Schema.check(Schema.isMinLength(1)));

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
		conflictToken: NonEmptyString,
		kind: Schema.Literal("historical"),
	}),
	Schema.Struct({
		kind: Schema.Literal("template-create"),
		sourceWorkoutId: Schema.optional(nonEmptyEntityId),
	}),
	Schema.Struct({
		entityId: nonEmptyEntityId,
		conflictToken: NonEmptyString,
		kind: Schema.Literal("template-edit"),
	}),
]);

export const WorkoutEditorDisplaySchema = Schema.Struct({
	durationUnit: DurationUnitSchema,
	weightUnit: Schema.Literals(["kg", "lb"]),
	distanceUnit: Schema.Literals(["km", "mi"]),
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
	clientId: NonEmptyString,
	included: Schema.Boolean,
	setLot: WorkoutSetLotSchema,
	exerciseKind: exerciseKindSchema,
	rpe: Schema.optional(Schema.String),
	note: Schema.optional(Schema.String),
	reps: Schema.optional(Schema.String),
	weight: Schema.optional(Schema.String),
	distance: Schema.optional(Schema.String),
	duration: Schema.optional(Schema.String),
	occurredAt: Schema.optional(IsoTimestamp),
	eventId: Schema.optional(nonEmptyEventId),
	restChoice: WorkoutEditorRestChoiceSchema,
	confirmedAt: Schema.optional(IsoTimestamp),
	restTimerStartedAt: Schema.optional(IsoTimestamp),
});

export const WorkoutEditorOccurrenceSchema = Schema.Struct({
	clientId: NonEmptyString,
	isCollapsed: Schema.Boolean,
	exerciseId: nonEmptyEntityId,
	exerciseKind: exerciseKindSchema,
	images: WorkoutEditorMediaSchema,
	videos: WorkoutEditorMediaSchema,
	notes: Schema.Array(Schema.String),
	sets: Schema.Array(WorkoutEditorSetSchema),
	display: Schema.optional(WorkoutEditorDisplaySchema),
	sourceExerciseOrder: Schema.optional(NonNegativeNumber),
});

export const WorkoutEditorSupersetSchema = Schema.Struct({
	clientId: NonEmptyString,
	color: SupersetColorSchema,
	occurrenceIds: Schema.Array(NonEmptyString),
});

export const WorkoutEditorCountdownSchema = Schema.Struct({
	setId: NonEmptyString,
	deadline: IsoTimestamp,
	clientId: NonEmptyString,
	occurrenceId: NonEmptyString,
	exerciseId: nonEmptyEntityId,
	durationSeconds: NonNegativeNumber,
	pausedRemainingSeconds: Schema.optional(NonNegativeNumber),
});

export const WorkoutEditorDraftSchema = Schema.Struct({
	name: Schema.String,
	draftId: NonEmptyString,
	mode: WorkoutEditorModeSchema,
	images: WorkoutEditorMediaSchema,
	videos: WorkoutEditorMediaSchema,
	displayEnergyUnit: EnergyUnitSchema,
	endedAt: Schema.optional(IsoTimestamp),
	comment: Schema.optional(Schema.String),
	startedAt: Schema.optional(IsoTimestamp),
	activeSetId: Schema.optional(NonEmptyString),
	caloriesBurnt: Schema.optional(Schema.String),
	kind: Schema.Literal("fitness-workout-editor"),
	stopwatchStartedAt: Schema.optional(IsoTimestamp),
	activeDuration: Schema.optional(NonNegativeNumber),
	activeOccurrenceId: Schema.optional(NonEmptyString),
	supersets: Schema.Array(WorkoutEditorSupersetSchema),
	activeDurationStartedAt: Schema.optional(IsoTimestamp),
	occurrences: Schema.Array(WorkoutEditorOccurrenceSchema),
	submission: Schema.optional(WorkoutEditorSaveInputSchema),
	pausedStopwatchSeconds: Schema.optional(NonNegativeNumber),
	restCountdown: Schema.optional(WorkoutEditorCountdownSchema),
	executionCountdown: Schema.optional(WorkoutEditorCountdownSchema),
	activeDurationIntent: Schema.Literals(["preserve", "set", "clear"]),
	localPreferences: Schema.optional(WorkoutEditorLocalPreferencesSchema),
	uploadedAssets: Schema.optional(Schema.Array(Schema.Union([LocalAssetLocator, S3AssetLocator]))),
	pendingRest: Schema.optional(
		Schema.Struct({
			setId: NonEmptyString,
			seconds: NonNegativeNumber,
			occurrenceId: NonEmptyString,
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
