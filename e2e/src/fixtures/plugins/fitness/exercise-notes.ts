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

import { invokeFitnessOperation } from "./operation-transport";

export const createExerciseNote = (client: Client, input: ExerciseNoteCreateInput) =>
	invokeFitnessOperation(client, exerciseNoteCreateRecipe, input);

export const updateExerciseNote = (client: Client, input: ExerciseNoteUpdateInput) =>
	invokeFitnessOperation(client, exerciseNoteUpdateRecipe, input);

export const deleteExerciseNote = (client: Client, input: ExerciseNoteDeleteInput) =>
	invokeFitnessOperation(client, exerciseNoteDeleteRecipe, input);
