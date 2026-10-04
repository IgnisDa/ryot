import type { ContractPayload } from "@ryot-app/contract/client";
import { type PluginPackageId, pluginPackageSegments } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { invokeOperationRecipe, type OperationRecipe } from "@ryot-app/plugin-kit/operations";
import { Effect, Schema } from "effect";

import type { Client } from "~/fixtures/kernel/auth";

export type RecipeInput<Recipe extends { readonly input: { readonly Type: unknown } }> =
	Recipe["input"]["Type"];

export type RecipeEncodedInput<Recipe extends { readonly input: { readonly Encoded: unknown } }> =
	Recipe["input"]["Encoded"];

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

export const invokeFitnessOperation = <
	Input,
	InputEncoded extends JsonValue,
	Output,
	OutputEncoded,
>(
	client: Client,
	recipe: OperationRecipe<Input, InputEncoded, Output, OutputEncoded>,
	input: Input,
) => invokeOperationRecipe(recipe, input, operationTransport(client));

export const invokeEncodedFitnessOperation = <
	Input,
	InputEncoded extends JsonValue,
	Output,
	OutputEncoded,
>(
	client: Client,
	recipe: OperationRecipe<Input, InputEncoded, Output, OutputEncoded>,
	payload: InputEncoded,
) =>
	operationTransport(client)({
		payload,
		packageId: recipe.packageId,
		operationSlug: recipe.operationSlug,
	}).pipe(Effect.flatMap(Schema.decodeUnknownEffect(recipe.output)));
