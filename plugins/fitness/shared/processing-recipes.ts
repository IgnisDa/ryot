import { Result } from "@ryot-app/plugin-kit/effect";
import {
	and,
	column,
	defineRecipe,
	eq,
	parameters,
	projectionProcessingState,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import { workoutSetProcessing } from "./fitness-metrics";

export const workoutProcessingRecipe = (input: { readonly reference: PluginIdentityReference }) => {
	const inputParameters = parameters({
		fields: {
			workoutId: {
				type: "string",
				label: "Workout Id",
				description: "Workout Id for this selection",
			},
			exerciseId: {
				type: "string",
				label: "Exercise Id",
				description: "Exercise Id for this selection",
			},
		},
	});
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ processing }) => Result.succeed(projectionProcessingState(processing)),
		queries: {
			processing: workoutSetProcessing(
				input.reference,
				and(
					inputParameters.whenSet(
						"workoutId",
						eq(
							column(table("event", "workoutSetProcessing"), "sessionEntityId"),
							inputParameters.value("workoutId"),
						),
					),
					inputParameters.whenSet(
						"exerciseId",
						eq(
							column(table("event", "workoutSetProcessing"), "entityId"),
							inputParameters.value("exerciseId"),
						),
					),
				),
			),
		},
	});
};
