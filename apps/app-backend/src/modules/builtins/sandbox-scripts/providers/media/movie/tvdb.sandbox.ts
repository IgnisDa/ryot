import { defineManifest } from "@ryot/sandbox-sdk";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import {
	asRecord,
	bcp47ToTvdb,
	buildTranslationResult,
	collectCompanies,
	collectGenres,
	collectImages,
	collectPeople,
	getLocalizedArtwork,
	getTranslationFields,
	numberValue,
	parsePublishYear,
	recordsValue,
	searchTvdb,
	stringValue,
	tvdbGet,
	tvdbGetOptional,
} from "../../tvdb-shared";

export const manifest = defineManifest({
	name: "TVDB",
	kind: "provider",
	slug: "movie.tvdb",
	requiredAppConfigKeys: ["providers.tvdbApiKey"],
	providerInformation: { source: "tvdb", canonicalLanguage: "en" },
	capabilities: ["httpCall", "getCachedValue", "setCachedValue", "getAppConfigValue"],
});

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	searchTvdb(host, input, { type: "movie", nameKeys: ["name", "title"] }),
);

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	if (!/^\d+$/.test(input.externalId)) {
		throw new Error("externalId must be a numeric TVDB movie ID");
	}
	const language = bcp47ToTvdb(manifest.providerInformation.canonicalLanguage);
	return Promise.all([
		tvdbGet(host, `/movies/${input.externalId}/extended`),
		tvdbGetOptional(host, `/movies/${input.externalId}/translations/${language}`),
	]).then(([data, translationData]) => {
		const movie = asRecord(data["data"]);
		if (!movie) {
			throw new Error("TVDB returned no data for this movie");
		}

		const translation = getTranslationFields(translationData);
		const fallbackTitle = stringValue(movie["name"]) ?? stringValue(movie["title"]);
		const title = translation.name ?? fallbackTitle;
		if (!title) {
			throw new Error("TVDB returned no title for this movie");
		}

		const images = collectImages([movie["image"], movie["image_url"]], movie["artworks"]);
		const genres = collectGenres(movie["genres"]);
		const firstAired = stringValue(movie["firstAired"]);
		const publishYear = parsePublishYear(movie["year"]) ?? parsePublishYear(firstAired);
		const averageRuntime = numberValue(movie["averageRuntime"]);
		const runtime =
			averageRuntime !== null && averageRuntime > 0 ? Math.trunc(averageRuntime) : null;
		const slug = stringValue(movie["slug"]);
		const sourceUrl = slug ? `https://thetvdb.com/movies/${slug}` : null;

		const groupRelatedEntities = recordsValue(movie["lists"])
			.filter((list) => list["is_official"] === true || list["isOfficial"] === true)
			.flatMap((list) => {
				const idNumber = numberValue(list["id"]);
				const groupExternalId =
					idNumber !== null ? String(Math.trunc(idNumber)) : stringValue(list["id"]);
				if (!groupExternalId) {
					return [];
				}
				return [
					{
						externalId: groupExternalId,
						scriptSlug: "movie-group.tvdb",
						name: stringValue(list["name"]) ?? "Loading...",
						relationshipProperties: { roles: ["Member"] },
					},
				];
			});

		const { relatedEntities, unlinkedCreators } = collectPeople(movie["characters"]);
		const companies = collectCompanies(movie["companies"]);

		return {
			name: title,
			relatedEntityGroups: [
				{
					direction: "incoming",
					synchronization: "additive",
					entities: relatedEntities,
					relationshipSchemaSlug: "person-to-movie",
				},
				{
					direction: "incoming",
					synchronization: "additive",
					entities: companies,
					relationshipSchemaSlug: "company-to-movie",
				},
				{
					direction: "incoming",
					synchronization: "additive",
					entities: groupRelatedEntities,
					relationshipSchemaSlug: "movie-group-to-movie",
				},
			],
			properties: {
				images,
				genres,
				runtime,
				sourceUrl,
				publishYear,
				unlinkedCreators,
				description: translation.description ?? stringValue(movie["overview"]),
			},
		};
	});
});

export const translate = defineProviderDriver(manifest, "translate", (input, host) => {
	if (!/^\d+$/.test(input.externalId)) {
		throw new Error("externalId must be a numeric TVDB movie ID");
	}
	const providerLanguage = bcp47ToTvdb(input.language);
	return Promise.all([
		tvdbGetOptional(host, `/movies/${input.externalId}/translations/${providerLanguage}`),
		tvdbGet(host, `/movies/${input.externalId}/extended`).catch(() => null),
	]).then(([translationData, detailsData]) => {
		const image = getLocalizedArtwork(
			detailsData ? asRecord(detailsData["data"])?.["artworks"] : null,
			providerLanguage,
		);
		return buildTranslationResult(translationData, image);
	});
});

export default defineProvider({ manifest, drivers: { search, details, translate } });
