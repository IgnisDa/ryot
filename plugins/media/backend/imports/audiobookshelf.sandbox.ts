import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

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
