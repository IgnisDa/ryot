import { existingEntity } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { EntityId, reviewProperties } from "@ryot-app/plugin-kit/schema";

import { ExerciseNoteCreateInput, ExerciseNoteOutput } from "../../shared/exercise-note-operations";
import { requireExerciseNoteExercise } from "./exercise-notes";

export const manifest = defineManifest({
	kind: "operation",
	name: "Create exercise note",
	slug: "operation.exercise-note-create",
});

export default defineOperation({
	manifest,
	output: ExerciseNoteOutput,
	input: ExerciseNoteCreateInput,
	run: (input, host) =>
		Effect.gen(function* () {
			const exerciseId = yield* requireExerciseNoteExercise(input.exerciseId, host.executeRyotql);
			return {
				output: { count: 1 },
				changes: {
					events: {
						changes: [],
						creates: [
							{
								eventSchemaSlug: "review",
								itemIdentity: `review:${exerciseId}`,
								entity: existingEntity(EntityId.make(exerciseId)),
								properties: reviewProperties({ text: input.text, rating: input.rating ?? null }),
							},
						],
					},
				},
			};
		}),
});
