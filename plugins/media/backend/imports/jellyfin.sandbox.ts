import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { recoverMediaApiTask } from "./api-collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { collectJellyfin } from "./jellyfin-collection";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.jellyfin",
	name: "Collect Jellyfin history",
});
export default defineActivity({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input, host) =>
		collectJellyfin(input, host).pipe(
			Effect.catch((error) => recoverMediaApiTask(input, error, "Jellyfin")),
			Effect.map((output) => ({ output })),
		),
});
