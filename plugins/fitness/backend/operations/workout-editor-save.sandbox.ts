import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import {
	WorkoutEditorSaveInputSchema,
	WorkoutEditorSaveOutputSchema,
} from "../../shared/workout-editor-operations";
import {
	saveWorkoutEditor,
	type WorkoutEditorSaveError,
	type WorkoutEditorSaveResult,
} from "./workout-editor-save";

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
			Effect.catch((error): Effect.Effect<WorkoutEditorSaveResult, WorkoutEditorSaveError> => {
				const reason = Schema.decodeUnknownResult(Schema.Struct({ code: Schema.String }))(
					"data" in error ? error.data : undefined,
				);
				return reason._tag === "Success" && reason.success.code === "asset-forbidden"
					? Effect.succeed({ output: { kind: "invalid", code: "media-forbidden" } as const })
					: Effect.fail(error);
			}),
		),
});
