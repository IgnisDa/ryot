import type { ContractPayload } from "@ryot-app/contract/client";
import { pluginPackageSegments } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import {
	exerciseOverrideUpdateRecipe,
	workoutDeleteRecipe,
	workoutEditorContextRecipe,
	workoutEditorSaveRecipe,
	workoutTimeCorrectionRecipe,
} from "@ryot-app/fitness-plugin/contracts/operation-recipes";
import type { OperationRecipe } from "@ryot-app/plugin-kit/operations";
import { Effect, Schema } from "effect";

import type { Client } from "~/fixtures/kernel/auth";

type InvokePayload = ContractPayload<"plugins", "invoke">["payload"];

const invokeFitnessOperation = Effect.fn("invokeFitnessOperation")(function* <
	Input,
	InputEncoded extends InvokePayload,
	Output,
	OutputEncoded,
>(
	client: Client,
	recipe: OperationRecipe<Input, InputEncoded, Output, OutputEncoded>,
	payload: InputEncoded,
) {
	const json = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(payload);
	const encoded = yield* Schema.decodeEffect(Schema.fromJsonString(JsonValue))(json);
	const response = yield* client.call((contract) =>
		contract.plugins.invoke({
			payload: { payload: encoded },
			params: { ...pluginPackageSegments(recipe.packageId), operationSlug: recipe.operationSlug },
		}),
	);
	return yield* Schema.decodeUnknownEffect(recipe.output)(response.result);
});

type RecipeInput<Recipe extends { readonly input: { readonly Encoded: unknown } }> =
	Recipe["input"]["Encoded"];

export const saveWorkoutEditor = (
	client: Client,
	input: RecipeInput<typeof workoutEditorSaveRecipe>,
) => invokeFitnessOperation(client, workoutEditorSaveRecipe, input);

export const loadWorkoutEditorContext = (
	client: Client,
	input: RecipeInput<typeof workoutEditorContextRecipe>,
) => invokeFitnessOperation(client, workoutEditorContextRecipe, input);

export const correctWorkoutTimes = (
	client: Client,
	input: RecipeInput<typeof workoutTimeCorrectionRecipe>,
) => invokeFitnessOperation(client, workoutTimeCorrectionRecipe, input);

export const deleteWorkout = (client: Client, input: RecipeInput<typeof workoutDeleteRecipe>) =>
	invokeFitnessOperation(client, workoutDeleteRecipe, input);

export const updateExerciseOverrides = (
	client: Client,
	input: RecipeInput<typeof exerciseOverrideUpdateRecipe>,
) => invokeFitnessOperation(client, exerciseOverrideUpdateRecipe, input);
