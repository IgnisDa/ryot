import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { collectAnilist, normalizeAnilist } from "./anilist-collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.anilist",
	name: "Collect AniList export",
});
export default defineActivity({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) => (input.action === "normalize" ? normalizeAnilist(input) : collectAnilist(input)),
});
