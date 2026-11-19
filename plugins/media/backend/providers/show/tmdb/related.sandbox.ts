import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { related } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Show Related",
	slug: "show.tmdb.related",
	relatedInputs: {
		"show-episode": {
			properties: ["parentShowExternalId", "seasonNumber", "episodeNumber"],
			groups: [
				{
					direction: "incoming",
					synchronization: "authoritative",
					relationshipSchemaSlug: "person-to-show-episode",
				},
			],
		},
	},
});

export default defineProvider({ manifest, run: related.run, operation: "related" });
