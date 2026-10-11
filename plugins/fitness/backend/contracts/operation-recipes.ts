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
	MeasurementReadingOutput,
	MeasurementReadingUpdateInput,
	measurementReadingDeleteOperationSlug,
	measurementReadingLogOperationSlug,
	measurementReadingUpdateOperationSlug,
} from "../../shared/measurement-reading-operations";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

const packageId = PLUGIN_PACKAGE_ID;

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
	output: MeasurementReadingOutput,
	input: MeasurementReadingLogInput,
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
