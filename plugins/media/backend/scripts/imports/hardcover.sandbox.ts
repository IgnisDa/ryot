import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { adaptHardcoverCsv } from "../../imports/hardcover";
import { batchMediaImportResult } from "../../imports/helpers";
import { MediaImportAdapterBatch, MediaImportParserInput } from "../../imports/schemas";
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
