import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { recoverMediaApiTask } from "./api-collection";
import { collectAudiobookshelf } from "./audiobookshelf-collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";

export const manifest = defineManifest({
	kind: "script",
	activity: true,
	slug: "import.audiobookshelf",
	name: "Collect Audiobookshelf history",
});
export default defineActivity({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input, host) =>
		collectAudiobookshelf(input, host).pipe(
			Effect.catch((error) => recoverMediaApiTask(input, error, "Audiobookshelf")),
			Effect.map((output) => ({ output })),
		),
});
