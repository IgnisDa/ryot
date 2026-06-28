import { defineDriver, defineManifest } from "@ryot/sandbox-sdk";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";
import * as z from "@ryot/sandbox-sdk/zod";

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
	requiredAppConfigKeys: ["providers.tmdbAccessToken"],
	providerInformation: { source: "tmdb", canonicalLanguage: "en" },
	capabilities: ["httpCall", "getAppConfigValue", "getUserPreferences"],
});

const search = defineProviderDriver(manifest, "search", (input, host) =>
	getTmdbAccessToken(host)
		.then((token) =>
			getUserIsNsfw(host).then((showNsfw) =>
				tmdbGet(
					host,
					"/search/tv",
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
	getTmdbAccessToken(host).then((token) =>
		getTmdbShowDetails(input, host, manifest.providerInformation.canonicalLanguage, token),
	),
);

const resolve = defineProviderDriver(manifest, "resolve", (input, host) => {
	if (input.identifierType !== "imdb") {
		throw new Error("TMDB show resolve supports only imdb identifiers");
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
			const [firstResult] = recordsValue(payload["tv_results"]);
			const showId = numberValue(firstResult?.["id"]);
			return { externalId: showId === null ? null : String(Math.trunc(showId)) };
		});
});

const translate = defineProviderDriver(manifest, "translate", (input, host) =>
	getTmdbAccessToken(host).then((token) => translateTmdbShow(input, host, token)),
);

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
					"/trending/tv/day",
					manifest.providerInformation.canonicalLanguage,
					token,
					{ scriptSlug: manifest.slug, nameKeys: ["name", "original_name"] },
				),
			)
			.then((items) => ({ items })),
});

export default defineProvider({
	manifest,
	drivers: { search, details, resolve, translate, trending },
});
