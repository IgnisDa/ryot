import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { batchMediaImportResult } from "./helpers";
import { adaptImdbCsv } from "./imdb";
import { MediaImportAdapterBatch, MediaImportParserInput } from "./schemas";
import { readImportArtifactText } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.imdb",
	name: "Parse IMDb import",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["artifact-read"],
});

export default defineScript({
	manifest,
	input: MediaImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input) =>
		readImportArtifactText().pipe(
			Effect.map((text) => batchMediaImportResult(adaptImdbCsv(text), input.start, input.limit)),
		),
});
