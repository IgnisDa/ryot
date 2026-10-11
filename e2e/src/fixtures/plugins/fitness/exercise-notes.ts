import type { ContractPayload, ContractPathParams } from "@ryot-app/contract/client";
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

import { fitnessFixtureInstallation } from "./exercises";

const operationTransport =
	(client: Client) =>
	(
		request: Pick<ContractPayload<"plugins", "invoke">, "payload"> &
			ContractPathParams<"plugins", "invoke">,
	) =>
		client
			.call((contract) =>
				contract.plugins.invoke({
					payload: { payload: request.payload },
					params: { pluginId: request.pluginId, operationSlug: request.operationSlug },
				}),
			)
			.pipe(Effect.map(({ result }) => result));

export const createExerciseNote = (client: Client, input: ExerciseNoteCreateInput) =>
	fitnessFixtureInstallation.pipe(
		Effect.flatMap(({ id }) =>
			invokeOperationRecipe(exerciseNoteCreateRecipe(id), input, operationTransport(client)),
		),
	);

export const updateExerciseNote = (client: Client, input: ExerciseNoteUpdateInput) =>
	fitnessFixtureInstallation.pipe(
		Effect.flatMap(({ id }) =>
			invokeOperationRecipe(exerciseNoteUpdateRecipe(id), input, operationTransport(client)),
		),
	);

export const deleteExerciseNote = (client: Client, input: ExerciseNoteDeleteInput) =>
	fitnessFixtureInstallation.pipe(
		Effect.flatMap(({ id }) =>
			invokeOperationRecipe(exerciseNoteDeleteRecipe(id), input, operationTransport(client)),
		),
	);
