import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { nowIso } from "./dates";
import { batchMediaImportResult } from "./helpers";
import { adaptMovaryExports } from "./movary";
import { MediaImportAdapterBatch, MediaImportParserInput } from "./schemas";
import { readNamedImportArtifactText } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.movary",
	name: "Parse Movary import",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["artifact-read"],
});

export default defineScript({
	manifest,
	input: MediaImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input) =>
		Effect.all(
			{
				historyCsv: readNamedImportArtifactText("historyUploadToken"),
				ratingsCsv: readNamedImportArtifactText("ratingsUploadToken"),
				watchlistCsv: readNamedImportArtifactText("watchlistUploadToken"),
			},
			{ concurrency: 3 },
		).pipe(
			Effect.map((files) =>
				batchMediaImportResult(
					adaptMovaryExports({ ...files, importedAt: nowIso() }),
					input.start,
					input.limit,
				),
			),
		),
});
