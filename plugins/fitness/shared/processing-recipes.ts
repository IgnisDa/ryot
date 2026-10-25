import { Result } from "@ryot-app/plugin-kit/effect";
import { defineRecipe, projectionProcessingState } from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import { workoutSetProcessing } from "./fitness-metrics";

export const workoutProcessingRecipe = defineRecipe(
	(input: {
		readonly workoutId?: string | undefined;
		readonly exerciseId?: string | undefined;
		readonly reference: PluginIdentityReference;
	}) => ({
		queries: { processing: workoutSetProcessing(input.reference, input) },
		map: ({ processing }) => Result.succeed(projectionProcessingState(processing)),
	}),
);
