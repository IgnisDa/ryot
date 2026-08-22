import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { batchMediaImportResult } from "./helpers";
import { adaptJellyfinData } from "./jellyfin";
import { JellyfinImportParserInput, MediaImportAdapterBatch } from "./schemas";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.jellyfin",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Fetch Jellyfin import",
});

export default defineScript({
	manifest,
	output: MediaImportAdapterBatch,
	input: JellyfinImportParserInput,
	run: (input, host) =>
		adaptJellyfinData(input, host).pipe(
			Effect.map((result) => batchMediaImportResult(result, input.start, input.limit)),
		),
});
