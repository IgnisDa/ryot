import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { cleanHtmlDescription } from "../../../lib/clean-html-description";
import { numberValue, stringValue } from "../../../lib/records";
import { toTitleCase } from "../../../lib/title-case-delimiters";
import {
	anilistGraphql,
	bcp47ToAnilistMode,
	collectGenres,
	collectImages,
	collectSuggestions,
	parseAnilistId,
	parsePublishYear,
	pickAnilistTitle,
	requireAnilistMedia,
	searchAnilistMedia,
	translateAnilistMedia,
} from "../../../lib/vendors/anilist";

export const manifest = defineManifest({
	name: "Anilist",
	kind: "provider",
	slug: "manga.anilist",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getUserPreferences"],
});

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) => searchAnilistMedia(host, input, { type: "MANGA", label: "manga" }),
});

const MEDIA_DETAILS_QUERY = `
query MediaDetailsQuery($id: Int!) {
  Media(id: $id) {
    id
    type
    genres
    status
    volumes
    isAdult
    chapters
    description
    bannerImage
    averageScore
    tags { name }
    startDate { year }
    title { english romaji native userPreferred }
    coverImage { extraLarge }
    recommendations { nodes { mediaRecommendation { id type title { english romaji native userPreferred } } } }
  }
}
`;

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) => {
		const titleLanguage = bcp47ToAnilistMode("en") ?? "english";
		return Effect.gen(function* () {
			const mediaId = yield* Effect.try({
				try: () => parseAnilistId(input.externalId, "media"),
				catch: (error) => (error instanceof Error ? error : new Error(String(error))),
			});
			const data = yield* anilistGraphql(host, "manga details", MEDIA_DETAILS_QUERY, {
				id: mediaId,
			});
			const media = yield* Effect.try({
				try: () => requireAnilistMedia(data, "MANGA"),
				catch: (error) => (error instanceof Error ? error : new Error(String(error))),
			});
			const idValue = numberValue(media["id"]);
			const payloadIdentifier = idValue === null ? input.externalId : String(Math.trunc(idValue));
			const title = pickAnilistTitle(media["title"], titleLanguage);
			if (!title) {
				return yield* Effect.fail({ message: "Anilist manga payload is missing title" });
			}
			const volumesValue = numberValue(media["volumes"]);
			const statusValue = stringValue(media["status"]);
			return {
				name: title,
				relatedEntityGroups: [
					{
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "media-suggestion",
						entities: collectSuggestions(media["recommendations"], titleLanguage),
					},
				],
				properties: {
					chapters: numberValue(media["chapters"]),
					publishYear: parsePublishYear(media["startDate"]),
					providerRating: numberValue(media["averageScore"]),
					genres: collectGenres(media["genres"], media["tags"]),
					description: cleanHtmlDescription(media["description"]),
					productionStatus: statusValue ? toTitleCase(statusValue) : null,
					images: collectImages(media["coverImage"], media["bannerImage"]),
					isNsfw: typeof media["isAdult"] === "boolean" ? media["isAdult"] : null,
					volumes: volumesValue === null ? null : Math.max(0, Math.trunc(volumesValue)),
					sourceUrl: `https://anilist.co/manga/${payloadIdentifier}/${encodeURIComponent(title)}`,
				},
			};
		});
	},
});

export const translate = defineProvider({
	manifest,
	operation: "translate",
	run: (input, host) => translateAnilistMedia(host, input, { type: "MANGA", label: "manga" }),
});
