import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";

import { collectAnilist, normalizeAnilist } from "./anilist-collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.anilist",
	name: "Collect AniList export",
});
export default defineScript({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) => (input.action === "normalize" ? normalizeAnilist(input) : collectAnilist(input)),
});
