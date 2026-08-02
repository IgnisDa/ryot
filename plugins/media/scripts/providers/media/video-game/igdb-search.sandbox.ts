import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./igdb";

export const manifest = defineManifest({
	kind: "provider",
	requiredSystemConfigKeys: [],
	name: "IGDB Video Game Search",
	slug: "video-game.igdb.search",
	requiredPluginConfigKeys: ["twitchClientId", "twitchClientSecret"],
	capabilities: ["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"],
	searchOptionsSchema: {
		unknownKeys: "strict",
		fields: {
			themeIds: {
				type: "array",
				label: "Theme IDs",
				description: "IGDB theme IDs",
				items: { type: "string", label: "Theme ID", description: "IGDB theme ID" },
			},
			genreIds: {
				type: "array",
				label: "Genre IDs",
				description: "IGDB genre IDs",
				items: { type: "string", label: "Genre ID", description: "IGDB genre ID" },
			},
			platformIds: {
				type: "array",
				label: "Platform IDs",
				description: "IGDB platform IDs",
				items: { type: "string", label: "Platform ID", description: "IGDB platform ID" },
			},
			gameModeIds: {
				type: "array",
				label: "Game mode IDs",
				description: "IGDB game mode IDs",
				items: { type: "string", label: "Game mode ID", description: "IGDB game mode ID" },
			},
			gameTypeIds: {
				type: "array",
				label: "Game type IDs",
				description: "IGDB game type IDs",
				items: { type: "string", label: "Game type ID", description: "IGDB game type ID" },
			},
			releaseDateRegionIds: {
				type: "array",
				label: "Release date region IDs",
				description: "IGDB release date region IDs",
				items: {
					type: "string",
					label: "Release date region ID",
					description: "IGDB release date region ID",
				},
			},
			allowGamesWithParent: {
				type: "boolean",
				label: "Allow games with a parent",
				description: "Include game versions that have a parent game",
			},
		},
	},
});

export default defineProvider({ manifest, operation: "search", run: search.run });
