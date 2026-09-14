import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { batchMediaImportResult } from "./helpers";
import { adaptIgdbCsv } from "./igdb";
import { IgdbImportParserInput, MediaImportAdapterBatch } from "./schemas";
import { readImportArtifactText } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.igdb",
	name: "Parse IGDB import",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["artifact-read"],
});

export default defineScript({
	manifest,
	input: IgdbImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input) =>
		readImportArtifactText().pipe(
			Effect.map((text) =>
				batchMediaImportResult(
					adaptIgdbCsv(text, { collection: input.collection }),
					input.start,
					input.limit,
				),
			),
		),
});
