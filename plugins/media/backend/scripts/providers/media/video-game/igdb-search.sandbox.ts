import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

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
				type: "enum-array",
				label: "Theme IDs",
				description: "IGDB theme IDs",
				choices: { kind: "dynamic", source: "themes" },
			},
			genreIds: {
				type: "enum-array",
				label: "Genre IDs",
				description: "IGDB genre IDs",
				choices: { kind: "dynamic", source: "genres" },
			},
			platformIds: {
				type: "enum-array",
				label: "Platform IDs",
				description: "IGDB platform IDs",
				choices: { kind: "dynamic", source: "platforms" },
			},
			gameModeIds: {
				type: "enum-array",
				label: "Game mode IDs",
				description: "IGDB game mode IDs",
				choices: { kind: "dynamic", source: "gameModes" },
			},
			gameTypeIds: {
				type: "enum-array",
				label: "Game type IDs",
				description: "IGDB game type IDs",
				choices: { kind: "dynamic", source: "gameTypes" },
			},
			releaseDateRegionIds: {
				type: "enum-array",
				label: "Release date region IDs",
				description: "IGDB release date region IDs",
				choices: { kind: "dynamic", source: "releaseDateRegions" },
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
