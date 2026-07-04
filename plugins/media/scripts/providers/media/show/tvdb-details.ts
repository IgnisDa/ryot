import type {
	ProviderDetailsChildEntity,
	ProviderDetailsInput,
	ProviderDetailsResult,
} from "@ryot/sandbox-sdk/provider";

import { parsePublishYear } from "../../../script-helpers/parse-publish-year";
import {
	type UnknownRecord,
	asRecord,
	numberValue,
	recordsValue,
	stringValue,
} from "../../../script-helpers/records";
import {
	bcp47ToTvdb,
	collectCompanies,
	collectGenres,
	collectImages,
	collectPeople,
	getTranslationFields,
	tvdbGet,
	tvdbGetOptional,
	type TvdbHost,
} from "../../tvdb-shared";

const buildSeason = (
	parentShowExternalId: string,
	season: UnknownRecord,
): ProviderDetailsChildEntity | null => {
	const idValue = numberValue(season["id"]);
	if (idValue === null || idValue <= 0) {
		return null;
	}
	const id = Math.trunc(idValue);
	const seasonNumberValue = numberValue(season["number"]);
	const seasonNumber = seasonNumberValue === null ? 0 : Math.trunc(seasonNumberValue);
	const year = stringValue(season["year"]);
	const releaseDate = year && /^\d{4}$/.test(year) ? `${year}-01-01` : null;
	const posterCandidates = [
		stringValue(season["image"]),
		...recordsValue(season["artwork"]).map((art) => stringValue(art["image"])),
	].flatMap((url) => (url ? [url] : []));
	const posterImage = posterCandidates[0] ?? null;
	const childEntities = recordsValue(season["episodes"]).flatMap((episode) => {
		const episodeIdValue = numberValue(episode["id"]);
		if (episodeIdValue === null || episodeIdValue <= 0) {
			return [];
		}
		const epName = stringValue(episode["name"]);
		const runtimeValue = numberValue(episode["runtime"]);
		const epRuntime = runtimeValue !== null && runtimeValue > 0 ? Math.trunc(runtimeValue) : null;
		const epNumberValue = numberValue(episode["number"]);
		const epNumber = epNumberValue === null ? 0 : Math.trunc(epNumberValue);
		const epImage = stringValue(episode["image"]);
		return [
			{
				entitySchemaSlug: "show-episode",
				externalId: String(Math.trunc(episodeIdValue)),
				name: epName ?? `Episode ${epNumber}`,
				properties: {
					seasonNumber,
					runtime: epRuntime,
					parentShowExternalId,
					description: stringValue(episode["overview"]),
					episodeNumber: epNumber,
					publishDate: stringValue(episode["aired"]),
					...(epImage ? { images: [{ type: "remote" as const, url: epImage }] } : {}),
				},
			},
		];
	});
	return {
		childEntities,
		externalId: String(id),
		name: `Season ${seasonNumber}`,
		entitySchemaSlug: "show-season",
		properties: {
			seasonNumber,
			parentShowExternalId,
			releaseDate,
			...(posterImage ? { images: [{ type: "remote" as const, url: posterImage }] } : {}),
		},
	};
};

export const getTvdbShowDetails = (
	input: ProviderDetailsInput,
	host: TvdbHost,
	canonicalLanguage: string,
): Promise<ProviderDetailsResult> => {
	if (!/^\d+$/.test(input.externalId)) {
		return Promise.reject(new Error("externalId must be a numeric TVDB series ID"));
	}
	const language = bcp47ToTvdb(canonicalLanguage);
	return Promise.all([
		tvdbGet(host, `/series/${input.externalId}/extended`),
		tvdbGetOptional(host, `/series/${input.externalId}/translations/${language}`),
	]).then(([data, translationData]) => {
		const show = asRecord(data["data"]);
		if (!show) {
			throw new Error("TVDB returned no data for this series");
		}
		const translation = getTranslationFields(translationData);
		const title = translation.name ?? stringValue(show["name"]);
		if (!title) {
			throw new Error("TVDB returned no name for this series");
		}
		const images = collectImages([show["image"]], show["artworks"]);
		const genres = collectGenres(show["genres"]);
		const { relatedEntities, unlinkedCreators } = collectPeople(show["characters"]);
		const firstAired = stringValue(show["firstAired"]);
		const publishYear = parsePublishYear(show["year"]) ?? parsePublishYear(firstAired);

		const seasonIdByNumber = new Map<number, number>();
		for (const season of recordsValue(show["seasons"])) {
			const numValue = numberValue(season["number"]);
			const idValue = numberValue(season["id"]);
			if (numValue === null || idValue === null) {
				continue;
			}
			const num = Math.trunc(numValue);
			if (!seasonIdByNumber.has(num)) {
				seasonIdByNumber.set(num, Math.trunc(idValue));
			}
		}
		const seasonIds = [...seasonIdByNumber.values()];
		const batches = Array.from({ length: Math.ceil(seasonIds.length / 5) }, (_, index) =>
			seasonIds.slice(index * 5, index * 5 + 5),
		);
		return batches
			.reduce<Promise<UnknownRecord[]>>(
				(loaded, batch) =>
					loaded.then((responses) =>
						Promise.all(batch.map((sid) => tvdbGet(host, `/seasons/${sid}/extended`))).then(
							(results) => [...responses, ...results],
						),
					),
				Promise.resolve([]),
			)
			.then((seasonResponses) => {
				const officialSeasons = seasonResponses
					.flatMap((response) => {
						const season = asRecord(response["data"]);
						return season ? [season] : [];
					})
					.filter((season) => asRecord(season["type"])?.["type"] === "official")
					.sort((a, b) => (numberValue(a["number"]) ?? 0) - (numberValue(b["number"]) ?? 0));
				const childEntities = officialSeasons.flatMap((season) => {
					const child = buildSeason(input.externalId, season);
					return child ? [child] : [];
				});
				const totalEpisodes = childEntities.reduce(
					(count, season) => count + (season.childEntities?.length ?? 0),
					0,
				);
				const slug = stringValue(show["slug"]);
				const sourceUrl = slug
					? `https://thetvdb.com/series/${slug}`
					: `https://thetvdb.com/series/${input.externalId}`;
				return {
					name: title,
					childEntities,
					relatedEntityGroups: [
						{
							direction: "incoming" as const,
							synchronization: "additive" as const,
							entities: relatedEntities,
							relationshipSchemaSlug: "person-to-show",
						},
						{
							direction: "incoming" as const,
							synchronization: "additive" as const,
							entities: collectCompanies(show["companies"]),
							relationshipSchemaSlug: "company-to-show",
						},
					],
					properties: {
						images,
						genres,
						sourceUrl,
						publishYear,
						totalEpisodes,
						unlinkedCreators,
						totalSeasons: childEntities.length,
						description: translation.description ?? stringValue(show["overview"]),
					},
				};
			});
	});
};
