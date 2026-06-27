import { defineDriver, defineManifest } from "@ryot/sandbox-sdk/core";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { getUserIsNsfw } from "../../../script-helpers/host";
import { parsePublishYear } from "../../../script-helpers/parse-publish-year";
import { numberValue, recordsValue, stringValue } from "../../../script-helpers/records";
import { fetchTrendingItems, getImageUrl, getTmdbAccessToken, tmdbGet } from "../../tmdb-shared";
import { getTmdbShowDetails } from "./tmdb-details";
import { translateTmdbShow } from "./tmdb-translation";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB",
	slug: "show.tmdb",
	requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"],
	providerInformation: { source: "tmdb", canonicalLanguage: "en" },
	capabilities: ["httpCall", "getAppConfigValue", "getUserPreferences"],
});

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	Effect.gen(function* () {
		const token = yield* getTmdbAccessToken(host);
		const showNsfw = yield* getUserIsNsfw(host);
		const data = yield* tmdbGet(
			host,
			"/search/tv",
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
			.flatMap((show) => {
				const id = numberValue(show["id"]);
				const title = stringValue(show["name"]);
				if (id === null || !title) {
					return [];
				}
				const image = getImageUrl(show["poster_path"]);
				const publishYear = parsePublishYear(show["first_air_date"]);
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
	Effect.flatMap(getTmdbAccessToken(host), (token) =>
		getTmdbShowDetails(input, host, manifest.providerInformation.canonicalLanguage, token),
	),
);

const resolve = defineProviderDriver(manifest, "resolve", (input, host) => {
	if (input.identifierType !== "imdb") {
		return Effect.fail(new Error("TMDB show resolve supports only imdb identifiers"));
	}
	return Effect.gen(function* () {
		const token = yield* getTmdbAccessToken(host);
		const payload = yield* tmdbGet(
			host,
			`/find/${encodeURIComponent(input.value)}`,
			{ external_source: "imdb_id" },
			token,
		);
		const [firstResult] = recordsValue(payload["tv_results"]);
		const showId = numberValue(firstResult?.["id"]);
		return { externalId: showId === null ? null : String(Math.trunc(showId)) };
	});
});

const translate = defineProviderDriver(manifest, "translate", (input, host) =>
	Effect.flatMap(getTmdbAccessToken(host), (token) => translateTmdbShow(input, host, token)),
);

export const trending = defineDriver(manifest, {
	input: Schema.Struct({}),
	output: Schema.Struct({
		items: Schema.Array(
			Schema.Struct({ name: Schema.NonEmptyString, externalId: Schema.NonEmptyString }),
		),
	}),
	run: (_input, host) =>
		Effect.flatMap(getTmdbAccessToken(host), (token) =>
			fetchTrendingItems(
				host,
				"/trending/tv/day",
				manifest.providerInformation.canonicalLanguage,
				token,
				{ scriptSlug: manifest.slug, nameKeys: ["name", "original_name"] },
			).pipe(Effect.map((items) => ({ items }))),
		),
});

export default defineProvider({
	manifest,
	drivers: { search, details, resolve, translate, trending },
});
