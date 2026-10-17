import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	WorkoutEditorContextOutputSchema,
	workoutEditorContextOperationSlug,
} from "../../shared/workout-editor-context-operations";

export const workoutEditorContextQuery = createRyotQuery(({ client }) =>
	client.operations.invoke({
		input: {},
		refreshOnSuccess: false,
		packageId: PLUGIN_PACKAGE_ID,
		slug: workoutEditorContextOperationSlug,
		output: WorkoutEditorContextOutputSchema,
	}),
);
