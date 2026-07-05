import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { adaptAnilistExport } from "../../imports/anilist";
import { batchMediaImportResult } from "../../imports/helpers";
import { MediaImportAdapterBatch, MediaImportParserInput } from "../../imports/schemas";
import { readImportArtifactText } from "./shared";

export const manifest = defineManifest({
	kind: "activity",
	name: "Parse AniList import",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: ["timezone"],
	slug: "activity.import.anilist",
	capabilities: ["artifact-read", "getSystemConfigValue"],
});
export default defineActivity({
	manifest,
	input: MediaImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input, host) =>
		Effect.gen(function* () {
			const text = yield* readImportArtifactText();
			const timezone = yield* host.getSystemConfigValue("timezone");
			if (typeof timezone !== "string") {
				throw new Error("App timezone is unavailable");
			}
			return batchMediaImportResult(adaptAnilistExport(text, timezone), input.start, input.limit);
		}),
});
