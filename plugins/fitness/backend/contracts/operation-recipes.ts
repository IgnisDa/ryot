import { defineOperationRecipe } from "@ryot-app/plugin-kit/operations";

import {
	ExerciseNoteCreateInput,
	ExerciseNoteDeleteInput,
	ExerciseNoteOutput,
	ExerciseNoteUpdateInput,
	exerciseNoteOperationSlugs,
} from "../../shared/exercise-note-operations";
import {
	MeasurementMetricCreateInput,
	MeasurementMetricCreateOutput,
	MeasurementMetricPinInput,
	MeasurementMetricPinOutput,
	measurementMetricCreateOperationSlug,
	measurementMetricPinOperationSlug,
} from "../../shared/measurement-metric-operations";
import {
	MeasurementReadingDeleteInput,
	MeasurementReadingLogInput,
	MeasurementReadingLogOutput,
	MeasurementReadingOutput,
	MeasurementReadingUpdateInput,
	measurementReadingDeleteOperationSlug,
	measurementReadingLogOperationSlug,
	measurementReadingUpdateOperationSlug,
} from "../../shared/measurement-reading-operations";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	ExerciseOverrideUpdateInputSchema,
	ExerciseOverrideUpdateOutputSchema,
	WorkoutEditorContextInputSchema,
	WorkoutEditorContextOutputSchema,
	exerciseOverrideUpdateOperationSlug,
	workoutEditorContextOperationSlug,
	workoutEditorSaveOperationSlug,
	workoutTimeCorrectionOperationSlug,
} from "../../shared/workout-editor-context-operations";
import {
	WorkoutEditorSaveInputSchema,
	WorkoutEditorSaveOutputSchema,
} from "../../shared/workout-editor-operations";
import {
	WorkoutTimeCorrectionInputSchema,
	WorkoutTimeCorrectionOutputSchema,
} from "../../shared/workout-time-operations";

const packageId = PLUGIN_PACKAGE_ID;

export const workoutEditorSaveRecipe = defineOperationRecipe({
	packageId,
	input: WorkoutEditorSaveInputSchema,
	output: WorkoutEditorSaveOutputSchema,
	operationSlug: workoutEditorSaveOperationSlug,
});
export const workoutEditorContextRecipe = defineOperationRecipe({
	packageId,
	input: WorkoutEditorContextInputSchema,
	output: WorkoutEditorContextOutputSchema,
	operationSlug: workoutEditorContextOperationSlug,
});
export const exerciseOverrideUpdateRecipe = defineOperationRecipe({
	packageId,
	input: ExerciseOverrideUpdateInputSchema,
	output: ExerciseOverrideUpdateOutputSchema,
	operationSlug: exerciseOverrideUpdateOperationSlug,
});
export const workoutTimeCorrectionRecipe = defineOperationRecipe({
	packageId,
	input: WorkoutTimeCorrectionInputSchema,
	output: WorkoutTimeCorrectionOutputSchema,
	operationSlug: workoutTimeCorrectionOperationSlug,
});

export const measurementMetricCreateRecipe = defineOperationRecipe({
	packageId,
	input: MeasurementMetricCreateInput,
	output: MeasurementMetricCreateOutput,
	operationSlug: measurementMetricCreateOperationSlug,
});

export const measurementMetricPinRecipe = defineOperationRecipe({
	packageId,
	input: MeasurementMetricPinInput,
	output: MeasurementMetricPinOutput,
	operationSlug: measurementMetricPinOperationSlug,
});

export const measurementReadingLogRecipe = defineOperationRecipe({
	packageId,
	input: MeasurementReadingLogInput,
	output: MeasurementReadingLogOutput,
	operationSlug: measurementReadingLogOperationSlug,
});

export const measurementReadingUpdateRecipe = defineOperationRecipe({
	packageId,
	output: MeasurementReadingOutput,
	input: MeasurementReadingUpdateInput,
	operationSlug: measurementReadingUpdateOperationSlug,
});

export const measurementReadingDeleteRecipe = defineOperationRecipe({
	packageId,
	output: MeasurementReadingOutput,
	input: MeasurementReadingDeleteInput,
	operationSlug: measurementReadingDeleteOperationSlug,
});

export const exerciseNoteCreateRecipe = defineOperationRecipe({
	packageId,
	output: ExerciseNoteOutput,
	input: ExerciseNoteCreateInput,
	operationSlug: exerciseNoteOperationSlugs.create,
});

export const exerciseNoteUpdateRecipe = defineOperationRecipe({
	packageId,
	output: ExerciseNoteOutput,
	input: ExerciseNoteUpdateInput,
	operationSlug: exerciseNoteOperationSlugs.update,
});

export const exerciseNoteDeleteRecipe = defineOperationRecipe({
	packageId,
	output: ExerciseNoteOutput,
	input: ExerciseNoteDeleteInput,
	operationSlug: exerciseNoteOperationSlugs.delete,
});
