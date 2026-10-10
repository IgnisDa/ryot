import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";

import {
	ExerciseOverrideUpdateInputSchema,
	ExerciseOverrideUpdateOutputSchema,
	WorkoutExerciseOverrideFieldSchema,
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
	run: ({ set, remove, exerciseId }, host) =>
		Effect.gen(function* () {
			if (new Set(remove).size !== remove.length || remove.some((key) => Object.hasOwn(set, key))) {
				return { kind: "invalid" } as const;
			}
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
			const properties = { ...membership.properties };
			for (const field of WorkoutExerciseOverrideFieldSchema.literals) {
				const value = set[field];
				if (value !== undefined) {
					properties[field] = value;
				}
			}
			for (const key of remove) {
				delete properties[key];
			}
			yield* host.changeUserRelationships([
				{
					deletes: [],
					creates: [
						{
							properties,
							propertiesMode: "replace",
							sourceEntityId: exerciseId,
							targetEntityId: membership.targetEntityId,
							relationshipSchemaSlug: "in-fitness-library",
						},
					],
				},
			]);
			return { kind: "saved" } as const;
		}),
});
