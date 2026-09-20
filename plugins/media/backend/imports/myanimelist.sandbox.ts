import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";

import { collectMediaXml } from "./collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { adaptMyanimelistExports, myanimelistCoverageCount } from "./myanimelist";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.myanimelist",
	name: "Collect MyAnimeList export",
});
export default defineScript({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) =>
		collectMediaXml(input, (xml, coverageStart) => ({
			coverageTotal: myanimelistCoverageCount(xml, input.fileIndex === 0 ? "anime" : "manga"),
			result: adaptMyanimelistExports({
				coverageStart,
				coverageLimit: 128,
				importedAt: input.importedAt,
				...(input.fileIndex === 0 ? { animeXml: xml } : { mangaXml: xml }),
			}),
		})),
});
