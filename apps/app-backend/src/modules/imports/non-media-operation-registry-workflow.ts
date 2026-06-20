import { Effect, Layer } from "effect";

import {
	OpenScaleImportItemSchema,
	loadOpenScaleAdapterResult,
	prepareOpenScaleWrites,
} from "./measurement/measurement-workflow";
import {
	NonMediaImportWorkflowOperations,
	makeNonMediaImportOperationSet,
} from "./non-media-types";
import { ImportRunError } from "./runtime/workflow-helpers";
import { WorkoutImportItemSchema } from "./workout/domain";
import {
	loadHevyWorkoutAdapterResult,
	loadStrongAppWorkoutAdapterResult,
	prepareWorkoutWrites,
} from "./workout/workout-workflow";

export const NonMediaImportWorkflowOperationsLive = Layer.succeed(
	NonMediaImportWorkflowOperations,
	{
		getOperations: (payload) => {
			if (payload.source === "open_scale") {
				return Effect.succeed(
					makeNonMediaImportOperationSet({
						itemSchema: OpenScaleImportItemSchema,
						prepareWrites: prepareOpenScaleWrites,
						loadAdapterResult: loadOpenScaleAdapterResult,
					}),
				);
			}
			if (payload.source === "hevy") {
				return Effect.succeed(
					makeNonMediaImportOperationSet({
						itemSchema: WorkoutImportItemSchema,
						prepareWrites: prepareWorkoutWrites,
						loadAdapterResult: loadHevyWorkoutAdapterResult,
					}),
				);
			}
			if (payload.source === "strong_app") {
				return Effect.succeed(
					makeNonMediaImportOperationSet({
						itemSchema: WorkoutImportItemSchema,
						prepareWrites: prepareWorkoutWrites,
						loadAdapterResult: loadStrongAppWorkoutAdapterResult,
					}),
				);
			}
			return Effect.fail(
				new ImportRunError({ message: `Unsupported import source: ${payload.source}` }),
			);
		},
	},
);
