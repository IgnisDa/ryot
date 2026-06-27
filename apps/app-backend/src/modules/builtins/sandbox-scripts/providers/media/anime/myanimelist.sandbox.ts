import { defineManifest } from "@ryot/sandbox-sdk";
import dayjs from "@ryot/sandbox-sdk/dayjs";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { toTitleCase } from "../../../script-helpers/title-case-delimiters";
import {
	asRecord,
	collectGenres,
	collectImages,
	collectSuggestionItems,
	getMalClientId,
	malGet,
	numberValue,
	parseIsNsfw,
	parsePublishDate,
	parsePublishYear,
	searchMal,
	stringValue,
} from "../../myanimelist-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "MyAnimeList",
	slug: "anime.myanimelist",
	providerInformation: { source: "myanimelist" },
	requiredAppConfigKeys: ["providers.malClientId"],
	capabilities: ["httpCall", "getAppConfigValue", "getUserPreferences"],
});

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	searchMal(host, input, { path: "anime" }),
);

const parseAiringSchedule = (startDate: unknown) => {
	const publishDate = parsePublishDate(startDate);
	if (!publishDate) {
		return null;
	}
	const parsed = dayjs(`${publishDate}T00:00:00Z`);
	return parsed.isValid() ? [{ episode: 1, airingAt: parsed.toISOString() }] : null;
};

export const details = defineProviderDriver(manifest, "details", (input, host) =>
	getMalClientId(host).then((clientId) => {
		const params = new URLSearchParams({
			fields:
				"start_date,synopsis,genres,status,num_episodes,mean,nsfw,main_picture,recommendations,related_manga,related_anime",
		});
		return malGet(
			host,
			clientId,
			`/anime/${encodeURIComponent(input.externalId)}`,
			params,
			"anime details",
		).then((payloadValue) => {
			const payload = asRecord(payloadValue);
			const idValue = numberValue(payload?.["id"]);
			const payloadIdentifier = idValue === null ? input.externalId : String(Math.trunc(idValue));
			const title = typeof payload?.["title"] === "string" ? payload["title"] : "";
			if (!title) {
				throw new Error("MyAnimeList anime payload is missing title");
			}
			const episodesValue = numberValue(payload?.["num_episodes"]);
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
							...collectSuggestionItems(payload?.["recommendations"], "anime.myanimelist"),
						],
					},
				],
				properties: {
					isNsfw: parseIsNsfw(payload?.["nsfw"]),
					genres: collectGenres(payload?.["genres"]),
					providerRating: numberValue(payload?.["mean"]),
					description: typeof synopsis === "string" ? synopsis : null,
					images: collectImages(payload?.["main_picture"]),
					publishDate: parsePublishDate(payload?.["start_date"]),
					publishYear: parsePublishYear(payload?.["start_date"]),
					airingSchedule: parseAiringSchedule(payload?.["start_date"]),
					productionStatus: statusValue ? toTitleCase(statusValue) : null,
					sourceUrl: `https://myanimelist.net/anime/${payloadIdentifier}/${title}`,
					episodes: episodesValue === null ? null : Math.max(0, Math.trunc(episodesValue)),
				},
			};
		});
	}),
);

export default defineProvider({ manifest, drivers: { search, details } });
