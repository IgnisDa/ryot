import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

import { recoverMediaApiTask } from "./api-collection";
import { collectAudiobookshelf } from "./audiobookshelf-collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.audiobookshelf",
	name: "Collect Audiobookshelf history",
});
export default defineScript({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input, host) =>
		collectAudiobookshelf(input, host).pipe(
			Effect.catch((error) => recoverMediaApiTask(input, error, "Audiobookshelf")),
		),
});
