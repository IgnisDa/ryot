import { Effect, Schema } from "effect";

export interface OperationRecipe<Input, InputEncoded, Output, OutputEncoded> {
	readonly pluginSlug: string;
	readonly operationSlug: string;
	readonly input: Schema.Schema<Input, InputEncoded>;
	readonly output: Schema.Schema<Output, OutputEncoded>;
}

export const defineOperationRecipe = <Input, InputEncoded, Output, OutputEncoded>(
	recipe: OperationRecipe<Input, InputEncoded, Output, OutputEncoded>,
): OperationRecipe<Input, InputEncoded, Output, OutputEncoded> => recipe;

export const invokeOperationRecipe = <Input, InputEncoded, Output, OutputEncoded, E>(
	recipe: OperationRecipe<Input, InputEncoded, Output, OutputEncoded>,
	input: Input,
	transport: (request: {
		readonly payload: unknown;
		readonly pluginSlug: string;
		readonly operationSlug: string;
	}) => Effect.Effect<unknown, E>,
) =>
	Schema.encode(recipe.input)(input).pipe(
		Effect.flatMap((payload) =>
			transport({
				payload,
				pluginSlug: recipe.pluginSlug,
				operationSlug: recipe.operationSlug,
			}),
		),
		Effect.flatMap(Schema.decodeUnknown(recipe.output)),
	);
