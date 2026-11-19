import { deleteEventChange } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { EventId } from "@ryot-app/plugin-kit/schema";

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
			return {
				output: { count: 1 },
				changes: { events: { creates: [], changes: [deleteEventChange(EventId.make(eventId))] } },
			};
		}),
});
