import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { executeRyotqlRecipe, type JsonValue } from "@ryot-app/plugin-backend-sdk/ryotql";

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
				workoutEditorExercisesRecipe({ exerciseIds: [exerciseId], reference: { kind: "self" } }),
			);
			const membership = yield* executeRyotqlRecipe(
				host.executeRyotql,
				workoutEditorMembershipRecipe({ exerciseId, reference: { kind: "self" } }),
			);
			if (exercises.items.length !== 1 || membership === null) {
				return { kind: "missing-exercise" } as const;
			}
			yield* host.changeUserRelationships([
				{
					deletes: [],
					creates: [
						{
							propertiesMode: "merge",
							sourceEntityId: exerciseId,
							targetEntityId: membership.targetEntityId,
							relationshipSchemaSlug: "in-fitness-library",
							properties: Object.fromEntries(
								Object.entries(overrides).flatMap(
									([key, value]: [string, JsonValue | undefined]) =>
										value === undefined ? [] : [[key, value]],
								),
							),
						},
					],
				},
			]);
			return { kind: "saved" } as const;
		}),
});
