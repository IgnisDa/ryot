import { PluginSlug } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import {
	exerciseNoteCreateRecipe,
	exerciseNoteDeleteRecipe,
	exerciseNoteUpdateRecipe,
} from "@ryot-app/fitness-plugin/contracts/operation-recipes";
import type {
	ExerciseNoteCreateInput,
	ExerciseNoteDeleteInput,
	ExerciseNoteUpdateInput,
} from "@ryot-app/fitness-plugin/contracts/operations";
import { invokeOperationRecipe } from "@ryot-app/plugin-kit/operations";
import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";

const operationTransport =
	(client: Client) =>
	(request: { payload: JsonValue; pluginSlug: string; operationSlug: string }) =>
		client
			.call((contract) =>
				contract.plugins.invoke({
					payload: { payload: request.payload },
					params: {
						operationSlug: request.operationSlug,
						pluginSlug: PluginSlug.make(request.pluginSlug),
					},
				}),
			)
			.pipe(Effect.map(({ result }) => result));

export const createExerciseNote = (client: Client, input: ExerciseNoteCreateInput) =>
	invokeOperationRecipe(exerciseNoteCreateRecipe, input, operationTransport(client));

export const updateExerciseNote = (client: Client, input: ExerciseNoteUpdateInput) =>
	invokeOperationRecipe(exerciseNoteUpdateRecipe, input, operationTransport(client));

export const deleteExerciseNote = (client: Client, input: ExerciseNoteDeleteInput) =>
	invokeOperationRecipe(exerciseNoteDeleteRecipe, input, operationTransport(client));
