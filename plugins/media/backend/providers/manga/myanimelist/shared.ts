import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { asRecord, numberValue, stringValue } from "../../../lib/records";
import { toTitleCase } from "../../../lib/title-case-delimiters";
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
} from "../../../lib/vendors/myanimelist";

export const manifest = defineManifest({
	kind: "provider",
	name: "MyAnimeList",
	slug: "manga.myanimelist",
	requiredSystemConfigKeys: [],
	requiredPluginConfigKeys: ["malClientId"],
	capabilities: ["httpCall", "getPluginConfig", "getUserPreferences"],
});

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) => searchMal(host, input, { path: "manga" }),
});

const collectProviderSuggestions = (entries: unknown, providerSlug: string) =>
	collectSuggestionItems(entries, providerSlug);

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		Effect.gen(function* () {
			const clientId = yield* getMalClientId(host);
			const params = new URLSearchParams({
				fields:
					"start_date,synopsis,genres,status,num_volumes,num_chapters,mean,nsfw,main_picture,recommendations,related_manga,related_anime",
			});
			const payloadValue = yield* malGet(
				host,
				clientId,
				`/manga/${encodeURIComponent(input.externalId)}`,
				params,
				"manga details",
			);
			const payload = asRecord(payloadValue);
			const idValue = numberValue(payload?.["id"]);
			const payloadIdentifier = idValue === null ? input.externalId : String(Math.trunc(idValue));
			const title = typeof payload?.["title"] === "string" ? payload["title"] : "";
			if (!title) {
				return yield* Effect.fail({ message: "MyAnimeList manga payload is missing title" });
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
							...collectProviderSuggestions(payload?.["related_anime"], "anime.myanimelist"),
							...collectProviderSuggestions(payload?.["related_manga"], "manga.myanimelist"),
							...collectProviderSuggestions(payload?.["recommendations"], "manga.myanimelist"),
						],
					},
				],
				properties: {
					isNsfw: parseIsNsfw(payload?.["nsfw"]),
					genres: collectGenres(payload?.["genres"]),
					providerRating: numberValue(payload?.["mean"]),
					chapters: numberValue(payload?.["num_chapters"]),
					images: collectImages(payload?.["main_picture"]),
					publishDate: parsePublishDate(payload?.["start_date"]),
					publishYear: parsePublishYear(payload?.["start_date"]),
					description: typeof synopsis === "string" ? synopsis : null,
					productionStatus: statusValue ? toTitleCase(statusValue) : null,
					sourceUrl: `https://myanimelist.net/manga/${payloadIdentifier}/${title}`,
					volumes: volumesValue === null ? null : Math.max(0, Math.trunc(volumesValue)),
				},
			};
		}),
});
