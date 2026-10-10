import { defineOperationRecipe } from "@ryot-app/plugin-kit/operations";
import type { PluginId } from "@ryot-app/plugin-kit/schema";

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
	MeasurementReadingOutput,
	MeasurementReadingUpdateInput,
	measurementReadingDeleteOperationSlug,
	measurementReadingLogOperationSlug,
	measurementReadingUpdateOperationSlug,
} from "../../shared/measurement-reading-operations";

export const measurementMetricCreateRecipe = defineOperationRecipe({
	pluginSlug: "fitness",
	input: MeasurementMetricCreateInput,
	output: MeasurementMetricCreateOutput,
	operationSlug: measurementMetricCreateOperationSlug,
});

export const measurementMetricPinRecipe = defineOperationRecipe({
	pluginSlug: "fitness",
	input: MeasurementMetricPinInput,
	output: MeasurementMetricPinOutput,
	operationSlug: measurementMetricPinOperationSlug,
});

export const measurementReadingLogRecipe = defineOperationRecipe({
	pluginSlug: "fitness",
	output: MeasurementReadingOutput,
	input: MeasurementReadingLogInput,
	operationSlug: measurementReadingLogOperationSlug,
});

export const measurementReadingUpdateRecipe = defineOperationRecipe({
	pluginSlug: "fitness",
	output: MeasurementReadingOutput,
	input: MeasurementReadingUpdateInput,
	operationSlug: measurementReadingUpdateOperationSlug,
});

export const measurementReadingDeleteRecipe = defineOperationRecipe({
	pluginSlug: "fitness",
	output: MeasurementReadingOutput,
	input: MeasurementReadingDeleteInput,
	operationSlug: measurementReadingDeleteOperationSlug,
});

export const exerciseNoteCreateRecipe = (pluginId: PluginId) =>
	defineOperationRecipe({
		pluginId,
		output: ExerciseNoteOutput,
		input: ExerciseNoteCreateInput,
		operationSlug: exerciseNoteOperationSlugs.create,
	});

export const exerciseNoteUpdateRecipe = (pluginId: PluginId) =>
	defineOperationRecipe({
		pluginId,
		output: ExerciseNoteOutput,
		input: ExerciseNoteUpdateInput,
		operationSlug: exerciseNoteOperationSlugs.update,
	});

export const exerciseNoteDeleteRecipe = (pluginId: PluginId) =>
	defineOperationRecipe({
		pluginId,
		output: ExerciseNoteOutput,
		input: ExerciseNoteDeleteInput,
		operationSlug: exerciseNoteOperationSlugs.delete,
	});
