import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";

import { collectMediaCsv } from "./collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { adaptMovaryExports } from "./movary";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.movary",
	name: "Collect Movary export",
	capabilities: ["artifact-read", "scratch"],
});
export default defineScript({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) =>
		collectMediaCsv(
			"movary",
			input,
			(text) =>
				adaptMovaryExports({
					importedAt: input.importedAt,
					watchlistCsv: input.fileIndex === 2 ? text : "title,tmdb_id",
					historyCsv: input.fileIndex === 0 ? text : "title,tmdb_id,watched_at",
					ratingsCsv: input.fileIndex === 1 ? text : "title,tmdb_id,user_rating",
				}),
			["historyUploadToken", "ratingsUploadToken", "watchlistUploadToken"][input.fileIndex],
		),
});
