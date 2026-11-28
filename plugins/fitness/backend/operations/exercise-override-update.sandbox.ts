import { existingEntity } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation, reject } from "@ryot-app/plugin-backend-sdk/operation";
import { executeRyotqlRecipe, type JsonValue } from "@ryot-app/plugin-backend-sdk/ryotql";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import { catalogMessage } from "../../shared/messages.generated";
import {
	ExerciseOverrideUpdateInputSchema,
	ExerciseOverrideUpdateOutputSchema,
} from "../../shared/workout-editor-context-operations";
import {
	workoutEditorExercisesRecipe,
	workoutEditorMembershipRecipe,
} from "../../shared/workout-editor-recipes";

export const manifest = defineManifest({
	kind: "operation",
	name: "Update exercise preferences",
	slug: "operation.exercise-override-update",
});

export default defineOperation({
	manifest,
	input: ExerciseOverrideUpdateInputSchema,
	output: ExerciseOverrideUpdateOutputSchema,
	run: ({ overrides, exerciseId }, host) =>
		Effect.gen(function* () {
			const exercises = yield* executeRyotqlRecipe(
				host.executeRyotql,
				workoutEditorExercisesRecipe({ reference: { kind: "self" } }),
				{ exerciseIds: [exerciseId] },
				{ pages: { exercises: { after: undefined } } },
			);
			const membership = yield* executeRyotqlRecipe(
				host.executeRyotql,
				workoutEditorMembershipRecipe({ reference: { kind: "self" } }),
				{ exerciseId },
			);
			if (exercises.items.length !== 1 || membership === null) {
				return yield* reject(catalogMessage("rejection.exercise-override.missing-exercise"));
			}
			return {
				output: {},
				changes: {
					relationships: {
						upserts: [
							{
								propertiesMode: "merge" as const,
								relationshipSchemaSlug: "in-fitness-library",
								source: existingEntity(EntityId.make(exerciseId)),
								target: existingEntity(EntityId.make(membership.targetEntityId)),
								properties: Object.fromEntries(
									Object.entries(overrides).flatMap(
										([key, value]: [string, JsonValue | undefined]) =>
											value === undefined ? [] : [[key, value]],
									),
								),
							},
						],
					},
				},
			};
		}),
});
