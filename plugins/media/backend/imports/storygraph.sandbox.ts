import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { batchMediaImportResult } from "./helpers";
import { MediaImportAdapterBatch, MediaImportParserInput } from "./schemas";
import { readImportArtifactText } from "./shared";
import { adaptStorygraphCsv } from "./storygraph";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.storygraph",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Parse StoryGraph import",
	capabilities: ["artifact-read"],
});

export default defineScript({
	manifest,
	input: MediaImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input) =>
		readImportArtifactText().pipe(
			Effect.map((text) =>
				batchMediaImportResult(adaptStorygraphCsv(text), input.start, input.limit),
			),
		),
});
