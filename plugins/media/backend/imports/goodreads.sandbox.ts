import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { adaptGoodreadsCsv } from "./goodreads";
import { batchMediaImportResult } from "./helpers";
import { MediaImportAdapterBatch, MediaImportParserInput } from "./schemas";
import { readImportArtifactText } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.goodreads",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Parse Goodreads import",
	capabilities: ["artifact-read"],
});

export default defineScript({
	manifest,
	input: MediaImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input) =>
		readImportArtifactText().pipe(
			Effect.map((text) =>
				batchMediaImportResult(adaptGoodreadsCsv(text), input.start, input.limit),
			),
		),
});
