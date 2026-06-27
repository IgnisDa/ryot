import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { batchMediaImportResult } from "../../imports/helpers";
import { adaptIgdbCsv } from "../../imports/igdb";
import { IgdbImportParserInput, MediaImportAdapterBatch } from "../../imports/schemas";
import { readImportArtifactText } from "./shared";

export const manifest = defineManifest({
	kind: "activity",
	name: "Parse IGDB import",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "activity.import.igdb",
	capabilities: ["artifact-read"],
});
export default defineActivity({
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
