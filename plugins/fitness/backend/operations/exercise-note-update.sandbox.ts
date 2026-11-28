import { updateEventChange } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { EventId, reviewPropertiesPatch } from "@ryot-app/plugin-kit/schema";

import { ExerciseNoteOutput, ExerciseNoteUpdateInput } from "../../shared/exercise-note-operations";
import { requireExerciseNote } from "./exercise-notes";

export const manifest = defineManifest({
	kind: "operation",
	name: "Update exercise note",
	slug: "operation.exercise-note-update",
});

export default defineOperation({
	manifest,
	output: ExerciseNoteOutput,
	input: ExerciseNoteUpdateInput,
	run: (input, host) =>
		Effect.gen(function* () {
			const eventId = yield* requireExerciseNote(input.noteId, host.executeRyotql);
			return {
				output: { count: 1 },
				changes: {
					events: {
						changes: [
							updateEventChange(EventId.make(eventId), {
								properties: reviewPropertiesPatch(input),
							}),
						],
					},
				},
			};
		}),
});
