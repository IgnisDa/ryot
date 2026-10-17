import type { ContractPayload } from "@ryot-app/contract/client";
import { type PluginPackageId, pluginPackageSegments } from "@ryot-app/contract/schema/brands";
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
import { invokeOperationRecipe } from "@ryot-app/plugin-kit/operations";
import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";

const operationTransport =
	(client: Client) =>
	(
		request: Pick<ContractPayload<"plugins", "invoke">, "payload"> & {
			readonly packageId: PluginPackageId;
			readonly operationSlug: string;
		},
	) =>
		client
			.call((contract) =>
				contract.plugins.invoke({
					payload: { payload: request.payload },
					params: {
						...pluginPackageSegments(request.packageId),
						operationSlug: request.operationSlug,
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
