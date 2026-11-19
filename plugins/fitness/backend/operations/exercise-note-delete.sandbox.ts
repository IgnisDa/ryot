import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import { ExerciseNoteDeleteInput, ExerciseNoteOutput } from "../../shared/exercise-note-operations";
import { requireExerciseNote } from "./exercise-notes";

export const manifest = defineManifest({
	kind: "operation",
	name: "Delete exercise note",
	slug: "operation.exercise-note-delete",
});

export default defineOperation({
	manifest,
	output: ExerciseNoteOutput,
	input: ExerciseNoteDeleteInput,
	run: (input, host) =>
		Effect.gen(function* () {
			const eventId = yield* requireExerciseNote(input.noteId, host.executeRyotql);
			return yield* host.deleteEvents([eventId]);
		}),
});
