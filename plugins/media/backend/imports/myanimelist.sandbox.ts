import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { collectMediaXml } from "./collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { adaptMyanimelistExports } from "./myanimelist";

export const manifest = defineManifest({
	kind: "script",
	activity: true,
	slug: "import.myanimelist",
	name: "Collect MyAnimeList export",
});
export default defineActivity({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) =>
		collectMediaXml(input, (xml) =>
			adaptMyanimelistExports({
				importedAt: input.importedAt,
				...(input.fileIndex === 0 ? { animeXml: xml } : { mangaXml: xml }),
			}),
		).pipe(Effect.map((output) => ({ output }))),
});
