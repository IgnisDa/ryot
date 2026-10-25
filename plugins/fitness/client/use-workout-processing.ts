import { createRyotQuery, useRyot, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";
import { useEffect, useRef } from "react";

import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import { workoutProcessingRecipe } from "../shared/processing-recipes";

type ProcessingScope = Omit<Parameters<typeof workoutProcessingRecipe>[0], "reference">;
const processingQuery = createRyotQuery<
	ProcessingScope,
	Recipe.Success<typeof workoutProcessingRecipe>
>(
	({ input, client }) =>
		client.data.query(
			workoutProcessingRecipe({ ...input, reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
		),
	{ refreshWhile: ({ data }) => data === "pending" },
);

export const useWorkoutProcessing = (input: ProcessingScope = {}) => {
	const result = useRyotQuery(processingQuery, input);
	const client = useRyot();
	const pending = result.data === undefined ? undefined : result.data === "pending";
	const previous = useRef(pending);
	useEffect(() => {
		if (previous.current === true && pending === false) {
			client.mutationCompleted.hint();
		}
		previous.current = pending;
	}, [pending, client]);
	return {
		loading: result.isPending,
		pending: pending ?? !result.isError,
		failed: result.isError || result.data === "failed",
	};
};
