import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";

import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { collectMediaTracker } from "./media-tracker-collection";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.media_tracker",
	name: "Collect MediaTracker history",
	capabilities: ["artifact-read", "scratch", "httpCall"],
});
export default defineScript({
	manifest,
	input: MediaSourceInput,
	run: collectMediaTracker,
	output: MediaSourceOutput,
});
