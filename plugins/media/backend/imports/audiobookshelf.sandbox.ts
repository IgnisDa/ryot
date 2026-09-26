import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { adaptAudiobookshelfData } from "./audiobookshelf";
import { batchMediaImportResult } from "./helpers";
import { MediaImportAdapterBatch, UrlAndKeyImportParserInput } from "./schemas";

export const manifest = defineManifest({
	kind: "script",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "import.audiobookshelf",
	name: "Fetch Audiobookshelf import",
});

export default defineScript({
	manifest,
	output: MediaImportAdapterBatch,
	input: UrlAndKeyImportParserInput,
	run: (input, host) =>
		adaptAudiobookshelfData(input, host).pipe(
			Effect.map((result) => batchMediaImportResult(result, input.start, input.limit)),
		),
});
