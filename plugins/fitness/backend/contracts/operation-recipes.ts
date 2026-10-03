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
	measurementMetricCreateOperationSlug,
} from "../../shared/measurement-metric-operations";

export const measurementMetricCreateRecipe = defineOperationRecipe({
	pluginSlug: "fitness",
	input: MeasurementMetricCreateInput,
	output: MeasurementMetricCreateOutput,
	operationSlug: measurementMetricCreateOperationSlug,
});

export const exerciseNoteCreateRecipe = defineOperationRecipe({
	pluginSlug: "fitness",
	output: ExerciseNoteOutput,
	input: ExerciseNoteCreateInput,
	operationSlug: exerciseNoteOperationSlugs.create,
});

export const exerciseNoteUpdateRecipe = defineOperationRecipe({
	pluginSlug: "fitness",
	output: ExerciseNoteOutput,
	input: ExerciseNoteUpdateInput,
	operationSlug: exerciseNoteOperationSlugs.update,
});

export const exerciseNoteDeleteRecipe = defineOperationRecipe({
	pluginSlug: "fitness",
	output: ExerciseNoteOutput,
	input: ExerciseNoteDeleteInput,
	operationSlug: exerciseNoteOperationSlugs.delete,
});
