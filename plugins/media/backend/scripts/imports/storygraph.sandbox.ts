import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { batchMediaImportResult } from "../../imports/helpers";
import { MediaImportAdapterBatch, MediaImportParserInput } from "../../imports/schemas";
import { adaptStorygraphCsv } from "../../imports/storygraph";
import { readImportArtifactText } from "./shared";

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
