import { defineManifest } from "@ryot/sandbox-sdk/core";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { numberValue, recordsValue, stringValue } from "../../script-helpers/records";
import {
	collectImages,
	firstTranslationValue,
	getImageUrl,
	getLocalizedImageUrl,
	getTmdbAccessToken,
	orderedTranslationCandidates,
	parseTranslationLanguage,
	tmdbGet,
} from "../tmdb-shared";

export const manifest = defineManifest({
	name: "TMDB",
	kind: "provider",
	slug: "movie-group.tmdb",
	capabilities: ["httpCall", "getAppConfigValue"],
	requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"],
	providerInformation: { source: "tmdb", canonicalLanguage: "en" },
});

const stripCollectionSuffix = (name: string) =>
	name.endsWith(" Collection") ? name.slice(0, -" Collection".length) : name;

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	getTmdbAccessToken(host)
		.then((token) =>
			tmdbGet(
				host,
				"/search/collection",
				{ query: input.query, language: "en-US", page: String(input.page) },
				token,
			),
		)
		.then((data) => {
			const results = recordsValue(data["results"]);
			const totalPages = numberValue(data["total_pages"]) ?? 1;
			const totalItems = numberValue(data["total_results"]) ?? results.length;
			const items = results
				.flatMap((collection) => {
					const id = numberValue(collection["id"]);
					const name = stringValue(collection["name"]);
					if (id === null || !name) {
						return [];
					}
					const image = getImageUrl(collection["poster_path"]);
					return [
						{
							externalId: String(Math.trunc(id)),
							titleProperty: { kind: "text" as const, value: name },
							calloutProperty: { kind: "null" as const, value: null },
							primarySubtitleProperty: { kind: "null" as const, value: null },
							secondarySubtitleProperty: { kind: "null" as const, value: null },
							imageProperty: image
								? { kind: "image" as const, value: { type: "remote" as const, url: image } }
								: { kind: "null" as const, value: null },
						},
					];
				})
				.slice(0, input.pageSize);
			return {
				items,
				details: { totalItems, nextPage: input.page < totalPages ? input.page + 1 : null },
			};
		}),
);

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	if (!/^\d+$/.test(input.externalId)) {
		throw new Error("externalId must be a numeric TMDB collection ID");
	}
	return getTmdbAccessToken(host)
		.then((token) =>
			Promise.all([
				tmdbGet(
					host,
					`/collection/${input.externalId}`,
					{ language: manifest.providerInformation.canonicalLanguage },
					token,
				),
				tmdbGet(host, `/collection/${input.externalId}/images`, {}, token),
			]),
		)
		.then(([collectionData, imagesData]) => {
			const rawName = stringValue(collectionData["name"]);
			if (!rawName) {
				throw new Error("TMDB returned no name for this collection");
			}
			const name = stripCollectionSuffix(rawName);
			const parts = recordsValue(collectionData["parts"]);
			const relatedEntities = parts.flatMap((part, index) => {
				const id = numberValue(part["id"]);
				if (id === null) {
					return [];
				}
				return [
					{
						scriptSlug: "movie.tmdb",
						externalId: String(Math.trunc(id)),
						relationshipProperties: { order: index + 1 },
						name: stringValue(part["title"]) ?? "Loading...",
					},
				];
			});
			return {
				name,
				relatedEntityGroups: [
					{
						entities: relatedEntities,
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "movie-group-to-movie",
					},
				],
				properties: {
					parts: parts.length,
					description: stringValue(collectionData["overview"]),
					sourceUrl: `https://www.themoviedb.org/collections/${input.externalId}-${name}`,
					images: collectImages(
						collectionData["poster_path"],
						collectionData["backdrop_path"],
						imagesData["posters"],
						imagesData["backdrops"],
					),
				},
			};
		});
});

export const translate = defineProviderDriver(manifest, "translate", (input, host) => {
	if (!/^\d+$/.test(input.externalId)) {
		throw new Error("externalId must be a numeric TMDB collection ID");
	}
	const { langCode, region } = parseTranslationLanguage(input.language);
	return getTmdbAccessToken(host)
		.then((token) =>
			Promise.all([
				tmdbGet(host, `/collection/${input.externalId}/translations`, {}, token),
				tmdbGet(
					host,
					`/collection/${input.externalId}/images`,
					{ include_image_language: langCode },
					token,
				).catch(() => ({})),
			]),
		)
		.then(([translationsData, imagesData]) => {
			const candidates = orderedTranslationCandidates(translationsData, langCode, region);
			const translatedName = firstTranslationValue(
				candidates,
				(data) => stringValue(data["title"]) ?? data["name"],
			);
			const name = translatedName ? stripCollectionSuffix(translatedName) : null;
			const description = firstTranslationValue(candidates, (data) => data["overview"]);
			const imageUrl = getLocalizedImageUrl(imagesData, "posters", langCode);
			const properties: Record<string, string | Array<{ type: "remote"; url: string }>> = {};
			if (description) {
				properties["description"] = description;
			}
			if (imageUrl) {
				properties["images"] = [{ type: "remote", url: imageUrl }];
			}
			return {
				...(name ? { name } : {}),
				...(Object.keys(properties).length > 0 ? { properties } : {}),
			};
		});
});

export default defineProvider({ manifest, drivers: { search, details, translate } });
