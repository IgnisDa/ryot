import { createRyotQuery, useRyot, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { useEffect, useRef } from "react";

import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import {
	workoutProcessingRecipe,
	type WorkoutProcessingStatus,
} from "../shared/processing-recipes";

type ProcessingScope = Omit<Parameters<typeof workoutProcessingRecipe>[0], "reference">;
const processingQuery = createRyotQuery<ProcessingScope, WorkoutProcessingStatus>(
	({ input, client }) =>
		client.data.query(
			workoutProcessingRecipe({ ...input, reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
		),
	{ refreshWhile: ({ data }) => data.pending },
);

export const useWorkoutProcessing = (input: ProcessingScope = {}) => {
	const result = useRyotQuery(processingQuery, input);
	const client = useRyot();
	const pending = result.data?.pending;
	const previous = useRef(pending);
	useEffect(() => {
		if (previous.current === true && pending === false) {
			client.mutationCompleted.hint();
		}
		previous.current = pending;
	}, [pending, client]);
	return {
		loading: result.isPending,
		pending: result.data?.pending ?? !result.isError,
		failed: result.isError || (result.data?.failed ?? false),
	};
};
