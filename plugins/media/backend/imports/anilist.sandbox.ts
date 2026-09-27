import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { adaptAnilistExport } from "./anilist";
import { batchMediaImportResult } from "./helpers";
import { AnilistImportParserInput, MediaImportAdapterBatch } from "./schemas";
import { readImportArtifactText } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.anilist",
	name: "Parse AniList import",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["artifact-read"],
});

export default defineScript({
	manifest,
	input: AnilistImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input) =>
		Effect.gen(function* () {
			const text = yield* readImportArtifactText;
			return batchMediaImportResult(
				adaptAnilistExport(text, input.timezone),
				input.start,
				input.limit,
			);
		}),
});
