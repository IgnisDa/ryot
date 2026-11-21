import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import {
	WorkoutEditorSaveInputSchema,
	WorkoutEditorSaveOutputSchema,
} from "../../shared/workout-editor-operations";
import { saveWorkoutEditor } from "./workout-editor-save";

export const manifest = defineManifest({
	kind: "operation",
	name: "Save workout or template",
	slug: "operation.workout-editor-save",
});

export default defineOperation({
	manifest,
	run: saveWorkoutEditor,
	input: WorkoutEditorSaveInputSchema,
	output: WorkoutEditorSaveOutputSchema,
});
