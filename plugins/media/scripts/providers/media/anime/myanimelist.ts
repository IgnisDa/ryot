import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { DateTime, Effect, Option } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

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
	slug: "anime.myanimelist",
	requiredPluginConfigKeys: ["malClientId"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getPluginConfig", "getUserPreferences"],
});

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) => searchMal(host, input, { path: "anime" }),
});

const collectProviderSuggestions = (entries: unknown, providerSlug: string) =>
	collectSuggestionItems(entries, providerSlug);

const parseAiringSchedule = (startDate: unknown) => {
	const publishDate = parsePublishDate(startDate);
	if (!publishDate) {
		return null;
	}
	const parsed = DateTime.make(`${publishDate}T00:00:00Z`);
	if (Option.isNone(parsed)) {
		return null;
	}
	return [{ episode: 1, airingAt: DateTime.formatIso(parsed.value) }];
};

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		Effect.gen(function* () {
			const clientId = yield* getMalClientId(host);
			const params = new URLSearchParams({
				fields:
					"start_date,synopsis,genres,status,num_episodes,mean,nsfw,main_picture,recommendations,related_manga,related_anime",
			});
			const payloadValue = yield* malGet(
				host,
				clientId,
				`/anime/${encodeURIComponent(input.externalId)}`,
				params,
				"anime details",
			);
			const payload = asRecord(payloadValue);
			const idValue = numberValue(payload?.["id"]);
			const payloadIdentifier = idValue === null ? input.externalId : String(Math.trunc(idValue));
			const title = typeof payload?.["title"] === "string" ? payload["title"] : "";
			if (!title) {
				return yield* Effect.fail({ message: "MyAnimeList anime payload is missing title" });
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
							...collectProviderSuggestions(payload?.["related_anime"], "anime.myanimelist"),
							...collectProviderSuggestions(payload?.["related_manga"], "manga.myanimelist"),
							...collectProviderSuggestions(payload?.["recommendations"], "anime.myanimelist"),
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
		}),
});
