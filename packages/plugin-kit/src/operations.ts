import type { PluginId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";

export interface OperationRecipe<Input, InputEncoded, Output, OutputEncoded> {
	readonly pluginId: PluginId;
	readonly operationSlug: string;
	readonly input: Schema.Schema<Input> & Schema.Encoder<InputEncoded>;
	readonly output: Schema.Decoder<Output> & Schema.Encoder<OutputEncoded>;
}

export const defineOperationRecipe = <Input, InputEncoded, Output, OutputEncoded>(
	recipe: OperationRecipe<Input, InputEncoded, Output, OutputEncoded>,
): OperationRecipe<Input, InputEncoded, Output, OutputEncoded> => recipe;

export const invokeOperationRecipe = <Input, InputEncoded, Output, OutputEncoded, E, R>(
	recipe: OperationRecipe<Input, InputEncoded, Output, OutputEncoded>,
	input: Input,
	transport: (request: {
		readonly pluginId: PluginId;
		readonly payload: InputEncoded;
		readonly operationSlug: string;
	}) => Effect.Effect<unknown, E, R>,
) =>
	Schema.encodeEffect(recipe.input)(input).pipe(
		Effect.flatMap((payload) =>
			transport({ payload, pluginId: recipe.pluginId, operationSlug: recipe.operationSlug }),
		),
		Effect.flatMap(Schema.decodeUnknownEffect(recipe.output)),
	);
