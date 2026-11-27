import {
	exerciseNoteCreateRecipe,
	exerciseNoteDeleteRecipe,
	exerciseNoteUpdateRecipe,
} from "@ryot-app/fitness-plugin/contracts/operation-recipes";
import type {
	ExerciseNoteCreateInput,
	ExerciseNoteDeleteInput,
	ExerciseNoteUpdateInput,
} from "@ryot-app/fitness-plugin/exercise-note-operations";

import type { Client } from "~/fixtures/kernel/auth";
import { invokeOperation } from "~/fixtures/kernel/operations";

export const createExerciseNote = (client: Client, input: ExerciseNoteCreateInput) =>
	invokeOperation(client, exerciseNoteCreateRecipe, input);

export const updateExerciseNote = (client: Client, input: ExerciseNoteUpdateInput) =>
	invokeOperation(client, exerciseNoteUpdateRecipe, input);

export const deleteExerciseNote = (client: Client, input: ExerciseNoteDeleteInput) =>
	invokeOperation(client, exerciseNoteDeleteRecipe, input);
