import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { mergeMediaRecords } from "./collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.merge",
	name: "Merge captured media records",
});
export default defineActivity({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) => mergeMediaRecords(input),
});
