import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { adaptHardcoverCsv } from "./hardcover";
import { batchMediaImportResult } from "./helpers";
import { MediaImportAdapterBatch, MediaImportParserInput } from "./schemas";
import { readImportArtifactText } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.hardcover",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Parse Hardcover import",
	capabilities: ["artifact-read"],
});

export default defineScript({
	manifest,
	input: MediaImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input) =>
		readImportArtifactText().pipe(
			Effect.map((text) =>
				batchMediaImportResult(adaptHardcoverCsv(text), input.start, input.limit),
			),
		),
});
