import { defineDriver, defineManifest } from "@ryot/sandbox-sdk";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";
import * as z from "@ryot/sandbox-sdk/zod";

import { getUserIsNsfw } from "../../../script-helpers/host";
import { parsePublishYear } from "../../../script-helpers/parse-publish-year";
import { asRecord, numberValue, recordsValue, stringValue } from "../../../script-helpers/records";
import {
	fetchTrendingItems,
	getImageUrl,
	getLocalizedImageUrl,
	getTmdbAccessToken,
	orderedTranslationCandidates,
	parseTranslationLanguage,
	tmdbGet,
} from "../../tmdb-shared";
import { getTmdbMovieDetails } from "./tmdb-details";

export const manifest = defineManifest({
	name: "TMDB",
	kind: "provider",
	slug: "movie.tmdb",
	requiredAppConfigKeys: ["providers.tmdbAccessToken"],
	providerInformation: { source: "tmdb", canonicalLanguage: "en" },
	capabilities: ["httpCall", "getAppConfigValue", "getUserPreferences"],
});

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	getTmdbAccessToken(host)
		.then((token) =>
			getUserIsNsfw(host).then((showNsfw) =>
				tmdbGet(
					host,
					"/search/movie",
					{
						language: "en-US",
						query: input.query,
						page: String(input.page),
						include_adult: showNsfw ? "true" : "false",
					},
					token,
				),
			),
		)
		.then((data) => {
			const results = recordsValue(data["results"]);
			const totalItems = numberValue(data["total_results"]) ?? results.length;
			const totalPages = numberValue(data["total_pages"]) ?? 1;
			const items = results
				.flatMap((movie) => {
					const id = numberValue(movie["id"]);
					const title = stringValue(movie["title"]);
					if (id === null || !title) {
						return [];
					}
					const image = getImageUrl(movie["poster_path"]);
					const publishYear = parsePublishYear(movie["release_date"]);
					return [
						{
							externalId: String(Math.trunc(id)),
							titleProperty: { kind: "text" as const, value: title },
							calloutProperty: { kind: "null" as const, value: null },
							secondarySubtitleProperty: { kind: "null" as const, value: null },
							imageProperty: image
								? { kind: "image" as const, value: { type: "remote" as const, url: image } }
								: { kind: "null" as const, value: null },
							primarySubtitleProperty:
								publishYear === null
									? { kind: "null" as const, value: null }
									: { kind: "number" as const, value: publishYear },
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

export const details = defineProviderDriver(manifest, "details", (input, host) =>
	getTmdbAccessToken(host).then((token) =>
		getTmdbMovieDetails(input, host, manifest.providerInformation.canonicalLanguage, token),
	),
);

const resolve = defineProviderDriver(manifest, "resolve", (input, host) => {
	if (input.identifierType !== "imdb") {
		throw new Error("TMDB movie resolve supports only imdb identifiers");
	}
	return getTmdbAccessToken(host)
		.then((token) =>
			tmdbGet(
				host,
				`/find/${encodeURIComponent(input.value)}`,
				{ external_source: "imdb_id" },
				token,
			),
		)
		.then((payload) => {
			const [firstResult] = recordsValue(payload["movie_results"]);
			const movieId = numberValue(firstResult?.["id"]);
			return { externalId: movieId === null ? null : String(Math.trunc(movieId)) };
		});
});

const translate = defineProviderDriver(manifest, "translate", (input, host) => {
	if (!/^\d+$/.test(input.externalId)) {
		throw new Error("externalId must be a numeric TMDB movie ID");
	}
	const { langCode, region } = parseTranslationLanguage(input.language);
	return getTmdbAccessToken(host)
		.then((token) =>
			Promise.all([
				tmdbGet(host, `/movie/${input.externalId}/translations`, {}, token),
				tmdbGet(
					host,
					`/movie/${input.externalId}/images`,
					{ include_image_language: langCode },
					token,
				),
			]),
		)
		.then(([translationsData, imagesData]) => {
			const [candidate] = orderedTranslationCandidates(translationsData, langCode, region);
			const translation = asRecord(candidate?.["data"]);
			const name = stringValue(translation?.["title"]);
			const description = stringValue(translation?.["overview"]);
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

export const trending = defineDriver(manifest, {
	input: z.object({}).strict(),
	output: z
		.object({
			items: z
				.array(z.object({ name: z.string().min(1), externalId: z.string().min(1) }).strict())
				.readonly(),
		})
		.strict(),
	run: (_input, host) =>
		getTmdbAccessToken(host)
			.then((token) =>
				fetchTrendingItems(
					host,
					"/trending/movie/day",
					manifest.providerInformation.canonicalLanguage,
					token,
					{ scriptSlug: manifest.slug, nameKeys: ["title", "original_title"] },
				),
			)
			.then((items) => ({ items })),
});

export default defineProvider({
	manifest,
	drivers: { search, details, resolve, translate, trending },
});
