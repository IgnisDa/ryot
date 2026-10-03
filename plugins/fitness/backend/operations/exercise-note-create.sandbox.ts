import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";

import { ExerciseNoteCreateInput, ExerciseNoteOutput } from "../contracts/operations";
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
			const entityId = yield* requireExerciseNoteExercise(input.exerciseId, host.executeRyotql);
			return yield* host.createEvents([
				{
					entityId,
					eventSchemaSlug: "review",
					properties:
						input.rating === undefined
							? { text: input.text }
							: { text: input.text, rating: input.rating },
				},
			]);
		}),
});
