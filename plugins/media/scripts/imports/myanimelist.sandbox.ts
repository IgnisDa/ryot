import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { gunzipSync, strFromU8 } from "@ryot/sandbox-sdk/fflate";
import { readNamedArtifact } from "@ryot/sandbox-sdk/filesystem";

import { batchMediaImportResult } from "../../imports/helpers";
import { adaptMyanimelistExports } from "../../imports/myanimelist";
import { MediaImportAdapterBatch, MyanimelistImportParserInput } from "../../imports/schemas";

export const manifest = defineManifest({
	kind: "activity",
	name: "Parse MyAnimeList import",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "activity.import.myanimelist",
	capabilities: ["artifact-read"],
});

const decodeXml = (bytes: Uint8Array) => {
	if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
		return strFromU8(gunzipSync(bytes));
	}
	return strFromU8(bytes);
};

export default defineActivity({
	manifest,
	input: MyanimelistImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input) =>
		Effect.gen(function* () {
			if (!input.hasAnimeFile && !input.hasMangaFile) {
				throw new Error("Import job is missing MyAnimeList export files");
			}
			const animeXml = input.hasAnimeFile
				? decodeXml(yield* readNamedArtifact("animeFilePath"))
				: undefined;
			const mangaXml = input.hasMangaFile
				? decodeXml(yield* readNamedArtifact("mangaFilePath"))
				: undefined;
			return batchMediaImportResult(
				adaptMyanimelistExports({ animeXml, mangaXml }),
				input.start,
				input.limit,
			);
		}),
});
