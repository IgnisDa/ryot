import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

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
	capabilities: ["httpCall", "getPluginConfigValue"],
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	requiredSystemConfigKeys: [],
});

const stripCollectionSuffix = (name: string) =>
	name.endsWith(" Collection") ? name.slice(0, -" Collection".length) : name;

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) =>
		Effect.gen(function* () {
			const token = yield* getTmdbAccessToken(host);
			const data = yield* tmdbGet(
				host,
				"/search/collection",
				{ query: input.query, language: "en-US", page: String(input.page) },
				token,
			);
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
});

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		Effect.gen(function* () {
			if (!/^\d+$/.test(input.externalId)) {
				return yield* Effect.fail(new Error("externalId must be a numeric TMDB collection ID"));
			}
			const token = yield* getTmdbAccessToken(host);
			const [collectionData, imagesData] = yield* Effect.all(
				[
					tmdbGet(host, `/collection/${input.externalId}`, { language: "en" }, token),
					tmdbGet(host, `/collection/${input.externalId}/images`, {}, token),
				],
				{ concurrency: "unbounded" },
			);
			const rawName = stringValue(collectionData["name"]);
			if (!rawName) {
				return yield* Effect.fail(new Error("TMDB returned no name for this collection"));
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
						providerSlug: "movie.tmdb",
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
		}),
});

export const translate = defineProvider({
	manifest,
	operation: "translate",
	run: (input, host) =>
		Effect.gen(function* () {
			if (!/^\d+$/.test(input.externalId)) {
				return yield* Effect.fail(new Error("externalId must be a numeric TMDB collection ID"));
			}
			const { langCode, region } = parseTranslationLanguage(input.language);
			const token = yield* getTmdbAccessToken(host);
			const [translationsData, imagesData] = yield* Effect.all(
				[
					tmdbGet(host, `/collection/${input.externalId}/translations`, {}, token),
					tmdbGet(
						host,
						`/collection/${input.externalId}/images`,
						{ include_image_language: langCode },
						token,
					).pipe(Effect.catch(() => Effect.succeed({}))),
				],
				{ concurrency: "unbounded" },
			);
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
		}),
});
