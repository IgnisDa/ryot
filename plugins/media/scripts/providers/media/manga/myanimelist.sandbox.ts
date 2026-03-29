import { defineManifest } from "@ryot/sandbox-sdk/core";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { asRecord, numberValue, stringValue } from "../../../script-helpers/records";
import { toTitleCase } from "../../../script-helpers/title-case-delimiters";
import {
	collectGenres,
	collectImages,
	collectSuggestionItems,
	getMalClientId,
	malGet,
	parseIsNsfw,
	parsePublishDate,
	parsePublishYear,
	searchMal,
} from "../../myanimelist-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "MyAnimeList",
	slug: "manga.myanimelist",
	providerInformation: { source: "myanimelist" },
	requiredAppConfigKeys: ["animeAndManga.malClientId"],
	capabilities: ["httpCall", "getAppConfigValue", "getUserPreferences"],
});

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	searchMal(host, input, { path: "manga" }),
);

export const details = defineProviderDriver(manifest, "details", (input, host) =>
	getMalClientId(host).then((clientId) => {
		const params = new URLSearchParams({
			fields:
				"start_date,synopsis,genres,status,num_volumes,num_chapters,mean,nsfw,main_picture,recommendations,related_manga,related_anime",
		});
		return malGet(
			host,
			clientId,
			`/manga/${encodeURIComponent(input.externalId)}`,
			params,
			"manga details",
		).then((payloadValue) => {
			const payload = asRecord(payloadValue);
			const idValue = numberValue(payload?.["id"]);
			const payloadIdentifier = idValue === null ? input.externalId : String(Math.trunc(idValue));
			const title = typeof payload?.["title"] === "string" ? payload["title"] : "";
			if (!title) {
				throw new Error("MyAnimeList manga payload is missing title");
			}
			const volumesValue = numberValue(payload?.["num_volumes"]);
			const statusValue = stringValue(payload?.["status"]);
			const synopsis = payload?.["synopsis"];
			return {
				name: title,
				relatedEntityGroups: [
					{
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "media-suggestion",
						entities: [
							...collectSuggestionItems(payload?.["related_anime"], "anime.myanimelist"),
							...collectSuggestionItems(payload?.["related_manga"], "manga.myanimelist"),
							...collectSuggestionItems(payload?.["recommendations"], "manga.myanimelist"),
						],
					},
				],
				properties: {
					isNsfw: parseIsNsfw(payload?.["nsfw"]),
					genres: collectGenres(payload?.["genres"]),
					providerRating: numberValue(payload?.["mean"]),
					chapters: numberValue(payload?.["num_chapters"]),
					description: typeof synopsis === "string" ? synopsis : null,
					images: collectImages(payload?.["main_picture"]),
					publishDate: parsePublishDate(payload?.["start_date"]),
					publishYear: parsePublishYear(payload?.["start_date"]),
					productionStatus: statusValue ? toTitleCase(statusValue) : null,
					sourceUrl: `https://myanimelist.net/manga/${payloadIdentifier}/${title}`,
					volumes: volumesValue === null ? null : Math.max(0, Math.trunc(volumesValue)),
				},
			};
		});
	}),
);

export default defineProvider({ manifest, drivers: { search, details } });
