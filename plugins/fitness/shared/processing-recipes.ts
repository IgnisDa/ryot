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
import { catalogMessage } from "./messages.generated";

export const workoutProcessingRecipe = (input: { readonly reference: PluginIdentityReference }) => {
	const inputParameters = parameters({
		fields: {
			workoutId: {
				type: "string",
				description: "Workout Id for this selection",
				label: catalogMessage("query-parameter.workout"),
			},
			exerciseId: {
				type: "string",
				description: "Exercise Id for this selection",
				label: catalogMessage("query-parameter.exercise"),
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
