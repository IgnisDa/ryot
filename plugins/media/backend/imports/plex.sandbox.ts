import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { recoverMediaApiTask } from "./api-collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { collectPlex } from "./plex-collection";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.plex",
	name: "Collect Plex history",
});
export default defineScript({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input, host) =>
		collectPlex(input, host).pipe(
			Effect.catch((error) => recoverMediaApiTask(input, error, "Plex")),
		),
});
