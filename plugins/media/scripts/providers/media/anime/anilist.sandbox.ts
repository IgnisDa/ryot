import dayjs from "@ryot/sandbox-sdk/dayjs";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import {
	defineProvider,
	defineProviderDriver,
	type ProviderDetailsRelatedEntity,
} from "@ryot/sandbox-sdk/provider";

import { cleanHtmlDescription } from "../../../script-helpers/clean-html-description";
import { asRecord, numberValue, stringValue } from "../../../script-helpers/records";
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
	slug: "anime.anilist",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall", "getUserPreferences"],
	providerInformation: { source: "anilist", canonicalLanguage: "en" },
});

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	searchAnilistMedia(host, input, { type: "ANIME", label: "anime" }),
);

const MEDIA_DETAILS_QUERY = `
query MediaDetailsQuery($id: Int!) {
  Media(id: $id) {
    id
    type
    genres
    status
    isAdult
    episodes
    description
    bannerImage
    averageScore
    tags { name }
    startDate { year }
    coverImage { extraLarge }
    nextAiringEpisode { episode airingAt }
    title { english romaji native userPreferred }
    airingSchedule { nodes { episode airingAt } }
    studios { nodes { id name } }
    recommendations { nodes { mediaRecommendation { id type title { english romaji native userPreferred } } } }
  }
}
`;

const toIsoDateTime = (unixSeconds: unknown) => {
	const seconds = numberValue(unixSeconds);
	if (seconds === null) {
		return null;
	}
	const parsed = dayjs.unix(Math.trunc(seconds));
	return parsed.isValid() ? parsed.toISOString() : null;
};

const parseAiringSchedule = (airingSchedule: unknown, nextAiringEpisode: unknown) => {
	const scheduleByEpisode = new Map<number, string>();

	const nodes = asRecord(airingSchedule)?.["nodes"];
	for (const node of Array.isArray(nodes) ? nodes : []) {
		const record = asRecord(node);
		if (!record) {
			continue;
		}
		const episodeValue = numberValue(record["episode"]);
		if (episodeValue === null) {
			continue;
		}
		const airingAt = toIsoDateTime(record["airingAt"]);
		if (!airingAt) {
			continue;
		}
		scheduleByEpisode.set(Math.trunc(episodeValue), airingAt);
	}

	const next = asRecord(nextAiringEpisode);
	if (next) {
		const episodeValue = numberValue(next["episode"]);
		const airingAt = toIsoDateTime(next["airingAt"]);
		if (episodeValue !== null && airingAt) {
			scheduleByEpisode.set(Math.trunc(episodeValue), airingAt);
		}
	}

	const schedule = [...scheduleByEpisode.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([episode, airingAt]) => ({ episode, airingAt }));

	return schedule.length > 0 ? schedule : null;
};

const collectStudios = (studios: unknown) => {
	const entities: ProviderDetailsRelatedEntity[] = [];
	const seenStudios = new Set<number>();
	const nodes = asRecord(studios)?.["nodes"];
	for (const studio of Array.isArray(nodes) ? nodes : []) {
		const record = asRecord(studio);
		if (!record) {
			continue;
		}
		const idValue = numberValue(record["id"]);
		if (idValue === null) {
			continue;
		}
		const studioId = Math.trunc(idValue);
		if (seenStudios.has(studioId)) {
			continue;
		}
		seenStudios.add(studioId);
		entities.push({
			scriptSlug: "company.anilist",
			externalId: String(studioId),
			relationshipProperties: { roles: ["Animation Studio"] },
			name: stringValue(record["name"]) ?? "Loading...",
		});
	}
	return entities;
};

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	const titleLanguage =
		bcp47ToAnilistMode(manifest.providerInformation.canonicalLanguage) ?? "english";
	return Effect.gen(function* () {
		const mediaId = yield* Effect.try({
			try: () => parseAnilistId(input.externalId, "media"),
			catch: (error) => (error instanceof Error ? error : new Error(String(error))),
		});
		const data = yield* anilistGraphql(host, "anime details", MEDIA_DETAILS_QUERY, { id: mediaId });
		const media = yield* Effect.try({
			try: () => requireAnilistMedia(data, "ANIME"),
			catch: (error) => (error instanceof Error ? error : new Error(String(error))),
		});
		const idValue = numberValue(media["id"]);
		const payloadIdentifier = idValue === null ? input.externalId : String(Math.trunc(idValue));
		const title = pickAnilistTitle(media["title"], titleLanguage);
		if (!title) {
			return yield* Effect.fail({ message: "Anilist anime payload is missing title" });
		}
		const episodesValue = numberValue(media["episodes"]);
		const statusValue = stringValue(media["status"]);
		return {
			name: title,
			relatedEntityGroups: [
				{
					direction: "incoming" as const,
					synchronization: "additive" as const,
					relationshipSchemaSlug: "company-to-anime",
					entities: collectStudios(media["studios"]),
				},
				{
					direction: "outgoing" as const,
					synchronization: "authoritative" as const,
					relationshipSchemaSlug: "media-suggestion",
					entities: collectSuggestions(media["recommendations"], titleLanguage),
				},
			],
			properties: {
				providerRating: numberValue(media["averageScore"]),
				publishYear: parsePublishYear(media["startDate"]),
				description: cleanHtmlDescription(media["description"]),
				genres: collectGenres(media["genres"], media["tags"]),
				productionStatus: statusValue ? toTitleCase(statusValue) : null,
				isNsfw: typeof media["isAdult"] === "boolean" ? media["isAdult"] : null,
				images: collectImages(media["coverImage"], media["bannerImage"]),
				episodes: episodesValue === null ? null : Math.max(0, Math.trunc(episodesValue)),
				sourceUrl: `https://anilist.co/anime/${payloadIdentifier}/${encodeURIComponent(title)}`,
				airingSchedule: parseAiringSchedule(media["airingSchedule"], media["nextAiringEpisode"]),
			},
		};
	});
});

export const translate = defineProviderDriver(manifest, "translate", (input, host) =>
	translateAnilistMedia(host, input, { type: "ANIME", label: "anime" }),
);

export default defineProvider({ manifest, drivers: { search, details, translate } });
