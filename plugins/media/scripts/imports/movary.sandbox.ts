import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { nowIso } from "../../imports/dates";
import { batchMediaImportResult } from "../../imports/helpers";
import { adaptMovaryExports } from "../../imports/movary";
import { MediaImportAdapterBatch, MediaImportParserInput } from "../../imports/schemas";
import { readNamedImportArtifactText } from "./shared";

export const manifest = defineManifest({
	kind: "activity",
	name: "Parse Movary import",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "activity.import.movary",
	capabilities: ["artifact-read"],
});

export default defineActivity({
	manifest,
	input: MediaImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input) =>
		Effect.all(
			{
				historyCsv: readNamedImportArtifactText("historyFilePath"),
				ratingsCsv: readNamedImportArtifactText("ratingsFilePath"),
				watchlistCsv: readNamedImportArtifactText("watchlistFilePath"),
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
