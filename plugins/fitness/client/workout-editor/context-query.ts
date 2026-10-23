import type { RyotClient } from "@ryot-app/plugin-client-sdk";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	WorkoutEditorContextInputSchema,
	workoutEditorContextOperationSlug,
	WorkoutEditorContextOutputSchema,
} from "../../shared/workout-editor-context-operations";

export const invokeWorkoutEditorContext = (client: RyotClient) =>
	client.operations.invoke({
		input: {},
		refreshOnSuccess: false,
		packageId: PLUGIN_PACKAGE_ID,
		slug: workoutEditorContextOperationSlug,
		output: WorkoutEditorContextOutputSchema,
		inputSchema: WorkoutEditorContextInputSchema,
	});

export const workoutEditorContextQuery = createRyotQuery(({ client }) =>
	invokeWorkoutEditorContext(client),
);
