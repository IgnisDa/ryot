import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import {
	EntityEditorSaveOutput,
	EntityEditorSubmission,
	isEntityEditorSubmissionAllowed,
} from "@ryot-app/plugin-kit/schema";

import { mediaEntityEditors } from "../../shared/media-entity-editors";

export const manifest = defineManifest({
	kind: "operation",
	name: "Save media entity",
	slug: "operation.media-entity-save",
});

export default defineOperation({
	manifest,
	input: EntityEditorSubmission,
	output: EntityEditorSaveOutput,
	run: (input, host) =>
		isEntityEditorSubmissionAllowed(mediaEntityEditors, input)
			? host.saveUserEntity(input)
			: Effect.succeed({ kind: "invalid", message: "Unsupported media save" } as const),
});
