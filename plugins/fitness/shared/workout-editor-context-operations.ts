import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import {
	WorkoutExerciseOverridesSchema,
	WorkoutPreferenceSettingsSchema,
} from "./workout-editor-preferences";

export const workoutEditorContextOperationSlug = "workout-editor-context";
export const exerciseOverrideUpdateOperationSlug = "exercise-override-update";
export const workoutEditorSaveOperationSlug = "workout-editor-save";
export const workoutTimeCorrectionOperationSlug = "workout-time-correction";

export const WorkoutEditorContextInputSchema = Schema.Struct({});
export const WorkoutEditorContextOutputSchema = Schema.Struct({
	proAvailable: Schema.Boolean,
	settings: WorkoutPreferenceSettingsSchema,
});
export const ExerciseOverrideUpdateInputSchema = Schema.Struct({
	exerciseId: EntityId,
	overrides: WorkoutExerciseOverridesSchema,
});
export const ExerciseOverrideUpdateOutputSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("saved") }),
	Schema.Struct({ kind: Schema.Literal("missing-exercise") }),
]);
