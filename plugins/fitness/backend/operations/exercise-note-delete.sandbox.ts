import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";

import { ExerciseNoteDeleteInput, ExerciseNoteOutput } from "../contracts/operations";
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
