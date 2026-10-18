import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import { exerciseKindSchema } from "./exercise-kinds";
import { IsoTimestamp, NonNegativeInt, Rpe } from "./fitness-primitives";
import { ExerciseNotesSchema } from "./workout-details-recipes";
import type { WorkoutActiveDurationChange } from "./workout-editor-operations";
import type { WorkoutEditorPropertiesSchema } from "./workout-editor-recipes";
import { WorkoutEditorMediaSchema, WorkoutSetLotSchema } from "./workout-set";

const nullableString = Schema.NullOr(Schema.String);
const nullableMeasurement = Schema.NullOr(Schema.Finite);
const optionalNullableMeasurement = Schema.optional(nullableMeasurement);
const optionalNullableString = Schema.optional(nullableString);
const optionalNullableMedia = Schema.optional(Schema.NullOr(WorkoutEditorMediaSchema));
const optionalNullableRest = Schema.optional(Schema.NullOr(NonNegativeInt));

export const WorkoutSupersetPropertySchema = Schema.Struct({
	color: Schema.String,
	exercises: Schema.Array(NonNegativeInt),
});

export const WorkoutExerciseMediaPropertySchema = Schema.Struct({
	exerciseOrder: NonNegativeInt,
	images: WorkoutEditorMediaSchema,
	videos: WorkoutEditorMediaSchema,
});

export const WorkoutPropertiesSchema = Schema.Struct({
	startedAt: IsoTimestamp,
	images: optionalNullableMedia,
	videos: optionalNullableMedia,
	activeDuration: optionalNullableRest,
	endedAt: Schema.optional(nullableString),
	comment: Schema.optional(nullableString),
	caloriesBurnt: optionalNullableMeasurement,
	exerciseNotes: Schema.optional(Schema.NullOr(ExerciseNotesSchema)),
	supersets: Schema.optional(Schema.NullOr(Schema.Array(WorkoutSupersetPropertySchema))),
	exerciseMedia: Schema.optional(Schema.NullOr(Schema.Array(WorkoutExerciseMediaPropertySchema))),
});

export const TemplateSetPropertiesSchema = Schema.Struct({
	setOrder: NonNegativeInt,
	setLot: WorkoutSetLotSchema,
	note: optionalNullableString,
	restTime: optionalNullableRest,
	reps: optionalNullableMeasurement,
	weight: optionalNullableMeasurement,
	duration: optionalNullableMeasurement,
	distance: optionalNullableMeasurement,
	rpe: Schema.optional(Schema.NullOr(Rpe)),
});

export const TemplateOccurrencePropertiesSchema = Schema.Struct({
	exerciseId: EntityId,
	images: optionalNullableMedia,
	videos: optionalNullableMedia,
	exerciseOrder: NonNegativeInt,
	notes: Schema.Array(Schema.String),
	sets: Schema.Array(TemplateSetPropertiesSchema),
});

export const TemplatePropertiesSchema = Schema.Struct({
	images: optionalNullableMedia,
	videos: optionalNullableMedia,
	comment: Schema.optional(nullableString),
	exercises: Schema.Array(TemplateOccurrencePropertiesSchema),
	supersets: Schema.optional(Schema.NullOr(Schema.Array(WorkoutSupersetPropertySchema))),
});

export const WorkoutSetPropertiesSchema = Schema.Struct({
	...TemplateSetPropertiesSchema.fields,
	exerciseOrder: NonNegativeInt,
	exerciseKind: exerciseKindSchema,
	confirmedAt: optionalNullableString,
	restTimerStartedAt: optionalNullableString,
	setLot: Schema.optional(WorkoutSetLotSchema),
});

export type WorkoutProperties = typeof WorkoutPropertiesSchema.Type;
export type WorkoutSetProperties = typeof WorkoutSetPropertiesSchema.Type;
export type TemplateSetProperties = typeof TemplateSetPropertiesSchema.Type;
export type TemplateOccurrenceProperties = typeof TemplateOccurrencePropertiesSchema.Type;

export const applyWorkoutTimes = (
	properties: typeof WorkoutEditorPropertiesSchema.Type,
	times: {
		readonly startedAt: string;
		readonly endedAt?: string | undefined;
		readonly activeDuration: WorkoutActiveDurationChange;
	},
) => {
	const next: Record<string, (typeof WorkoutEditorPropertiesSchema.Type)[string]> = {
		...properties,
		startedAt: times.startedAt,
	};
	delete next["endedAt"];
	if (times.endedAt !== undefined) {
		next["endedAt"] = times.endedAt;
	}
	if (times.activeDuration.kind === "clear") {
		delete next["activeDuration"];
	}
	if (times.activeDuration.kind === "set") {
		next["activeDuration"] = times.activeDuration.seconds;
	}
	return next;
};
