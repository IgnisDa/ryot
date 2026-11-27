import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";

import { mergeMediaRecords } from "./collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.merge",
	name: "Merge captured media records",
});
export default defineScript({
	manifest,
	run: mergeMediaRecords,
	input: MediaSourceInput,
	output: MediaSourceOutput,
});
