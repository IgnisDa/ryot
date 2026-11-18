import { isEntitled, type RyotClient } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	WorkoutEditorContextInputSchema,
	workoutEditorContextOperationSlug,
	WorkoutEditorContextOutputSchema,
} from "../../shared/workout-editor-context-operations";
import type { WorkoutEditorContext } from "./controller-types";

export const invokeWorkoutEditorContext = (client: RyotClient) =>
	Effect.all(
		{
			account: client.account,
			operation: client.operations
				.invoke({
					input: {},
					refreshOnSuccess: false,
					packageId: PLUGIN_PACKAGE_ID,
					slug: workoutEditorContextOperationSlug,
					output: WorkoutEditorContextOutputSchema,
					inputSchema: WorkoutEditorContextInputSchema,
				})
				.pipe(Effect.map(({ output }) => output)),
		},
		{ concurrency: "unbounded" },
	).pipe(
		Effect.map(({ account, operation }): WorkoutEditorContext =>
			Object.assign({}, operation, { pro: isEntitled(account.entitlements, "pro") }),
		),
	);

export const workoutEditorContextQuery = createRyotQuery(({ client }) =>
	invokeWorkoutEditorContext(client),
);
