import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { recoverMediaApiTask } from "./api-collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { collectJellyfin } from "./jellyfin-collection";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.jellyfin",
	name: "Collect Jellyfin history",
});
export default defineScript({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input, host) =>
		collectJellyfin(input, host).pipe(
			Effect.catch((error) => recoverMediaApiTask(input, error, "Jellyfin")),
		),
});
