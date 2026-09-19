import { defineOperationRecipe } from "@ryot-app/plugin-kit/operations";

import {
	ExerciseNoteCreateInput,
	ExerciseNoteDeleteInput,
	ExerciseNoteOutput,
	ExerciseNoteUpdateInput,
} from "./operations";

export const exerciseNoteCreateRecipe = defineOperationRecipe({
	pluginSlug: "fitness",
	output: ExerciseNoteOutput,
	input: ExerciseNoteCreateInput,
	operationSlug: "exercise-note-create",
});

export const exerciseNoteUpdateRecipe = defineOperationRecipe({
	pluginSlug: "fitness",
	output: ExerciseNoteOutput,
	input: ExerciseNoteUpdateInput,
	operationSlug: "exercise-note-update",
});

export const exerciseNoteDeleteRecipe = defineOperationRecipe({
	pluginSlug: "fitness",
	output: ExerciseNoteOutput,
	input: ExerciseNoteDeleteInput,
	operationSlug: "exercise-note-delete",
});
