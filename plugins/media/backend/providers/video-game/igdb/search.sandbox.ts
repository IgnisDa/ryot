import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "IGDB Video Game Search",
	slug: "video-game.igdb.search",
	searchOptionsSchema: {
		unknownKeys: "strict",
		fields: {
			themeIds: {
				type: "enum-array",
				description: "IGDB theme IDs",
				label: { key: "property.theme-ids" },
				hint: { key: "property.theme-ids-hint" },
				choices: { kind: "dynamic", source: "themes" },
			},
			genreIds: {
				type: "enum-array",
				description: "IGDB genre IDs",
				label: { key: "property.genre-ids" },
				hint: { key: "property.genre-ids-hint" },
				choices: { kind: "dynamic", source: "genres" },
			},
			platformIds: {
				type: "enum-array",
				description: "IGDB platform IDs",
				label: { key: "property.platform-ids" },
				hint: { key: "property.platform-ids-hint" },
				choices: { kind: "dynamic", source: "platforms" },
			},
			gameModeIds: {
				type: "enum-array",
				description: "IGDB game mode IDs",
				label: { key: "property.game-mode-ids" },
				hint: { key: "property.game-mode-ids-hint" },
				choices: { kind: "dynamic", source: "gameModes" },
			},
			gameTypeIds: {
				type: "enum-array",
				description: "IGDB game type IDs",
				label: { key: "property.game-type-ids" },
				hint: { key: "property.game-type-ids-hint" },
				choices: { kind: "dynamic", source: "gameTypes" },
			},
			allowGamesWithParent: {
				type: "boolean",
				label: { key: "property.allow-games-with-a-parent" },
				hint: { key: "property.allow-games-with-a-parent-hint" },
				description: "Include game versions that have a parent game",
			},
			releaseDateRegionIds: {
				type: "enum-array",
				description: "IGDB release date region IDs",
				label: { key: "property.release-date-region-ids" },
				hint: { key: "property.release-date-region-ids-hint" },
				choices: { kind: "dynamic", source: "releaseDateRegions" },
			},
		},
	},
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
