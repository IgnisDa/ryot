import { isCommitConflict } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import {
	WorkoutEditorSaveInputSchema,
	type WorkoutEditorSaveOutput,
	WorkoutEditorSaveOutputSchema,
} from "../../shared/workout-editor-operations";
import { saveWorkoutEditor, type WorkoutEditorSaveError } from "./workout-editor-save";

export const manifest = defineManifest({
	kind: "operation",
	name: "Save workout or template",
	slug: "operation.workout-editor-save",
});

export default defineOperation({
	manifest,
	input: WorkoutEditorSaveInputSchema,
	output: WorkoutEditorSaveOutputSchema,
	run: (input, host) =>
		saveWorkoutEditor(input, host).pipe(
			Effect.catch(
				(
					error: WorkoutEditorSaveError,
				): Effect.Effect<WorkoutEditorSaveOutput, WorkoutEditorSaveError> => {
					if ("data" in error && isCommitConflict(error)) {
						return Effect.succeed({ kind: "conflict" } as const);
					}
					const reason = Schema.decodeUnknownResult(Schema.Struct({ code: Schema.String }))(
						"data" in error ? error.data : undefined,
					);
					if (reason._tag === "Success" && reason.success.code === "asset-forbidden") {
						return Effect.succeed({ kind: "invalid", code: "media-forbidden" } as const);
					}
					return Effect.fail(error);
				},
			),
		),
});
