import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

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
	type TmdbHost,
} from "../../tmdb-shared";
import { getTmdbMovieDetails } from "./tmdb-details";

const canonicalLanguage = "en";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Movie",
	slug: "movie.tmdb",
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getPluginConfig", "getUserPreferences"],
});

const httpManifest = defineManifest({
	kind: "provider",
	name: "TMDB Movie",
	slug: "movie.tmdb",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	requiredSystemConfigKeys: [],
});

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) =>
		Effect.gen(function* () {
			const token = yield* getTmdbAccessToken(host);
			const showNsfw = yield* getUserIsNsfw(host);
			const data = yield* tmdbGet(
				host,
				"/search/movie",
				{
					language: "en-US",
					query: input.query,
					page: String(input.page),
					include_adult: showNsfw ? "true" : "false",
				},
				token,
			);
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
});

export const details = defineProvider({
	manifest: httpManifest,
	operation: "details",
	run: (input, host) =>
		Effect.flatMap(getTmdbAccessToken(host), (token) =>
			getTmdbMovieDetails(input, host, canonicalLanguage, token),
		),
});

export const resolve = defineProvider({
	manifest: httpManifest,
	operation: "resolve",
	run: (input, host) => {
		if (input.identifierType !== "imdb") {
			return Effect.fail(new Error("TMDB movie resolve supports only imdb identifiers"));
		}
		return Effect.gen(function* () {
			const token = yield* getTmdbAccessToken(host);
			const payload = yield* tmdbGet(
				host,
				`/find/${encodeURIComponent(input.value)}`,
				{ external_source: "imdb_id" },
				token,
			);
			const [firstResult] = recordsValue(payload["movie_results"]);
			const movieId = numberValue(firstResult?.["id"]);
			return { externalId: movieId === null ? null : String(Math.trunc(movieId)) };
		});
	},
});

export const translate = defineProvider({
	manifest: httpManifest,
	operation: "translate",
	run: (input, host) => {
		if (!/^\d+$/.test(input.externalId)) {
			return Effect.fail(new Error("externalId must be a numeric TMDB movie ID"));
		}
		const { langCode, region } = parseTranslationLanguage(input.language);
		return Effect.gen(function* () {
			const token = yield* getTmdbAccessToken(host);
			const [translationsData, imagesData] = yield* Effect.all([
				tmdbGet(host, `/movie/${input.externalId}/translations`, {}, token),
				tmdbGet(
					host,
					`/movie/${input.externalId}/images`,
					{ include_image_language: langCode },
					token,
				),
			]);
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
	},
});

export const trending = {
	input: Schema.Struct({}),
	output: Schema.Struct({
		items: Schema.Array(
			Schema.Struct({ name: Schema.NonEmptyString, externalId: Schema.NonEmptyString }),
		),
	}),
	run: (_input: unknown, host: TmdbHost) =>
		Effect.flatMap(getTmdbAccessToken(host), (token) =>
			fetchTrendingItems(host, "/trending/movie/day", canonicalLanguage, token, {
				nameKeys: ["title", "original_title"],
				providerSlug: manifest.slug,
			}).pipe(Effect.map((items) => ({ items }))),
		),
};
