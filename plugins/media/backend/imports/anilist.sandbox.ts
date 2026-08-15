import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { adaptAnilistExport } from "./anilist";
import { batchMediaImportResult } from "./helpers";
import { MediaImportAdapterBatch, MediaImportParserInput } from "./schemas";
import { readImportArtifactText } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.anilist",
	name: "Parse AniList import",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: ["timezone"],
	capabilities: ["artifact-read", "getSystemConfig"],
});

export default defineScript({
	manifest,
	input: MediaImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input, host) =>
		Effect.gen(function* () {
			const text = yield* readImportArtifactText();
			const { timezone } = yield* host.getSystemConfig(["timezone"]);
			if (typeof timezone !== "string") {
				throw new Error("App timezone is unavailable");
			}
			return batchMediaImportResult(adaptAnilistExport(text, timezone), input.start, input.limit);
		}),
});
