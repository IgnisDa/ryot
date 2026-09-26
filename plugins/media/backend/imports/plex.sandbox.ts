import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { batchMediaImportResult } from "./helpers";
import { adaptPlexData } from "./plex";
import { MediaImportAdapterBatch, UrlAndKeyImportParserInput } from "./schemas";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.plex",
	name: "Fetch Plex import",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineScript({
	manifest,
	output: MediaImportAdapterBatch,
	input: UrlAndKeyImportParserInput,
	run: (input, host) =>
		adaptPlexData(input, host).pipe(
			Effect.map((result) => batchMediaImportResult(result, input.start, input.limit)),
		),
});
