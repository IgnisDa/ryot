import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import {
	WorkoutDeleteInputSchema,
	WorkoutDeleteOutputSchema,
} from "../../shared/workout-delete-operations";

export const manifest = defineManifest({
	kind: "operation",
	name: "Delete workout",
	slug: "operation.workout-delete",
});

export default defineOperation({
	manifest,
	input: WorkoutDeleteInputSchema,
	output: WorkoutDeleteOutputSchema,
	run: (input) =>
		Effect.succeed({
			output: { entityId: input.entityId },
			changes: {
				entities: { deletes: [{ entityId: input.entityId, entitySchemaSlug: "workout" }] },
			},
		}),
});
