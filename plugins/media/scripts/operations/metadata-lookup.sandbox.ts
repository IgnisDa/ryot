import { defineDriver, defineManifest, defineOperation } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";

import {
	MetadataLookupInput,
	MetadataLookupOutput,
	type MetadataLookupResult,
} from "../../operations/schemas";
import {
	manifest as movieTmdbManifest,
	search as movieTmdbSearch,
} from "../providers/media/movie/tmdb.sandbox";
import {
	manifest as showTmdbManifest,
	search as showTmdbSearch,
} from "../providers/media/show/tmdb.sandbox";
import {
	chooseBestMetadataLookupTitleMatch,
	type MetadataLookupTitleMatchCandidate,
} from "../script-helpers/title-matching";
import {
	extractMetadataLookupBaseTitle,
	extractMetadataLookupSeasonEpisode,
} from "../script-helpers/title-parsing";

export const manifest = defineManifest({
	kind: "operation",
	name: "Metadata Lookup",
	slug: "operation.metadata-lookup",
	requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"],
	capabilities: ["httpCall", "getIntegration", "getAppConfigValue", "getUserPreferences"],
});

const searchProviders = [
	{
		driver: movieTmdbSearch,
		entitySchemaSlug: "movie",
		scriptSlug: movieTmdbManifest.slug,
	},
	{
		driver: showTmdbSearch,
		entitySchemaSlug: "show",
		scriptSlug: showTmdbManifest.slug,
	},
] as const;

const notFound = { notFound: true, status: "notFound" } as const satisfies MetadataLookupResult;

export const operation = defineDriver(manifest, {
	input: MetadataLookupInput,
	output: MetadataLookupOutput,
	run: (input, host, execution) =>
		Effect.gen(function* () {
			const titles = input.titles.map((title) => title.trim());
			if (titles.some((title) => title === "")) {
				return yield* Effect.fail(new Error("title is required"));
			}

			const integration = yield* host.getIntegration(input.integrationId);
			if (integration.provider !== "ryot_browser_extension") {
				return yield* Effect.fail(new Error("Integration is not a browser extension integration"));
			}

			const results: MetadataLookupResult[] = [];
			for (const title of titles) {
				const query = extractMetadataLookupBaseTitle(title).trim();
				if (!query) {
					return yield* Effect.fail(new Error("title is required"));
				}

				const searched = yield* Effect.forEach(
					searchProviders,
					(provider) =>
						provider.driver.run({ query, page: 1, pageSize: 20 }, host, execution).pipe(
							Effect.map(({ items }) =>
								items.map(
									(item): MetadataLookupTitleMatchCandidate => ({
										externalId: item.externalId,
										scriptSlug: provider.scriptSlug,
										title: item.titleProperty.value,
										entitySchemaSlug: provider.entitySchemaSlug,
										publishYear:
											item.primarySubtitleProperty?.kind === "number"
												? item.primarySubtitleProperty.value
												: null,
									}),
								),
							),
						),
					{ concurrency: 2 },
				);

				const match = chooseBestMetadataLookupTitleMatch({ title, results: searched.flat() });
				if (!match) {
					results.push(notFound);
					continue;
				}

				const showInformation =
					match.entitySchemaSlug === "show" ? extractMetadataLookupSeasonEpisode(title) : undefined;
				results.push({
					status: "found",
					title: match.title,
					...(showInformation ? { showInformation } : {}),
					data: { source: "tmdb", lot: match.entitySchemaSlug, identifier: match.externalId },
				});
			}

			return { results };
		}),
});

export default defineOperation({ manifest, drivers: { operation } });
