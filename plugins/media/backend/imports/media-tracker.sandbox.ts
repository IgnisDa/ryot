import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { collectMediaTracker } from "./media-tracker-collection";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.media_tracker",
	name: "Collect MediaTracker history",
});
export default defineActivity({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input, host) => collectMediaTracker(input, host).pipe(Effect.map((output) => ({ output }))),
});
