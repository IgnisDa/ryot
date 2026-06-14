import { defineManifest } from "@ryot/sandbox-sdk";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { cleanHtmlDescription } from "../../../script-helpers/clean-html-description";
import { numberValue, stringValue } from "../../../script-helpers/records";
import { toTitleCase } from "../../../script-helpers/title-case-delimiters";
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
} from "../../anilist-shared";

export const manifest = defineManifest({
	name: "Anilist",
	kind: "provider",
	slug: "manga.anilist",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall", "getUserPreferences"],
	providerInformation: { source: "anilist", canonicalLanguage: "en" },
});

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	searchAnilistMedia(host, input, { type: "MANGA", label: "manga" }),
);

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

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	const mediaId = parseAnilistId(input.externalId, "media");
	const titleLanguage =
		bcp47ToAnilistMode(manifest.providerInformation.canonicalLanguage) ?? "english";
	return anilistGraphql(host, "manga details", MEDIA_DETAILS_QUERY, { id: mediaId }).then(
		(data) => {
			const media = requireAnilistMedia(data, "MANGA");
			const idValue = numberValue(media["id"]);
			const payloadIdentifier = idValue === null ? input.externalId : String(Math.trunc(idValue));
			const title = pickAnilistTitle(media["title"], titleLanguage);
			if (!title) {
				throw new Error("Anilist manga payload is missing title");
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
					providerRating: numberValue(media["averageScore"]),
					publishYear: parsePublishYear(media["startDate"]),
					description: cleanHtmlDescription(media["description"]),
					genres: collectGenres(media["genres"], media["tags"]),
					productionStatus: statusValue ? toTitleCase(statusValue) : null,
					isNsfw: typeof media["isAdult"] === "boolean" ? media["isAdult"] : null,
					images: collectImages(media["coverImage"], media["bannerImage"]),
					volumes: volumesValue === null ? null : Math.max(0, Math.trunc(volumesValue)),
					sourceUrl: `https://anilist.co/manga/${payloadIdentifier}/${encodeURIComponent(title)}`,
				},
			};
		},
	);
});

export const translate = defineProviderDriver(manifest, "translate", (input, host) =>
	translateAnilistMedia(host, input, { type: "MANGA", label: "manga" }),
);

export default defineProvider({ manifest, drivers: { search, details, translate } });
