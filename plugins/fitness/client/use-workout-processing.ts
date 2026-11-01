import { createRyotQuery, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";

import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import { workoutProcessingRecipe } from "../shared/processing-recipes";

type ProcessingScope = Omit<Parameters<typeof workoutProcessingRecipe>[0], "reference">;
const processingQuery = createRyotQuery<
	ProcessingScope,
	Recipe.Success<typeof workoutProcessingRecipe>
>(({ input, client }) =>
	client.data.query(
		workoutProcessingRecipe({ ...input, reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
	),
);

export const useWorkoutProcessing = (input: ProcessingScope = {}) => {
	const result = useRyotQuery(processingQuery, input);
	return { failed: result.data === "failed", pending: result.data === "pending" };
};
