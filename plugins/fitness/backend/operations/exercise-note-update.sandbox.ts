import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import { ExerciseNoteOutput, ExerciseNoteUpdateInput } from "../../shared/exercise-note-operations";
import { exerciseNotePropertiesPatch, requireExerciseNote } from "./exercise-notes";

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
			return yield* host.updateEvents([
				{ eventId, patch: { properties: exerciseNotePropertiesPatch(input) } },
			]);
		}),
});
