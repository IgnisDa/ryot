import type { ContractPayload } from "@ryot-app/contract/client";
import { type PluginPackageId, pluginPackageSegments } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { invokeOperationRecipe, type OperationRecipe } from "@ryot-app/plugin-kit/operations";
import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";

export type RecipeInput<Recipe extends { readonly input: { readonly Type: unknown } }> =
	Recipe["input"]["Type"];

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
