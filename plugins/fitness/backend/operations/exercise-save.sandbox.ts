import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import {
	EntityEditorSaveOutput,
	EntityEditorSubmission,
	isEntityEditorSubmissionAllowed,
} from "@ryot-app/plugin-kit/schema";

import { exerciseEditors } from "../../shared/exercise-save-operations";

export const manifest = defineManifest({
	kind: "operation",
	name: "Save exercise",
	slug: "operation.exercise-save",
});

export default defineOperation({
	manifest,
	input: EntityEditorSubmission,
	output: EntityEditorSaveOutput,
	run: (input, host) =>
		isEntityEditorSubmissionAllowed(exerciseEditors, input)
			? host.saveUserEntity(input)
			: Effect.succeed({ kind: "invalid", message: "Unsupported exercise save" } as const),
});
