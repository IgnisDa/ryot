import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import {
	WorkoutEditorSaveInputSchema,
	WorkoutEditorSaveOutputSchema,
	type WorkoutEditorSaveOutput,
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
					const reason = Schema.decodeUnknownResult(Schema.Struct({ code: Schema.String }))(
						"data" in error ? error.data : undefined,
					);
					if (
						reason._tag === "Success" &&
						["mutation-conflict", "event-stale", "event-not-found", "entity-not-found"].includes(
							reason.success.code,
						)
					) {
						return Effect.succeed({ kind: "conflict" } as const);
					}
					if (reason._tag === "Success" && reason.success.code === "asset-forbidden") {
						return Effect.succeed({ kind: "invalid", code: "media-forbidden" } as const);
					}
					return Effect.fail(error);
				},
			),
		),
});
