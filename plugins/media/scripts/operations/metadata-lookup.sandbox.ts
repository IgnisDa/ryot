import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineOperation } from "@ryot/sandbox-sdk/operation";

import {
	MetadataLookupInput,
	MetadataLookupOutput,
	type MetadataLookupResult,
} from "../../operations/schemas";
import {
	chooseBestMetadataLookupTitleMatch,
	type MetadataLookupTitleMatchCandidate,
} from "../../shared/title-matching";
import {
	extractMetadataLookupBaseTitle,
	extractMetadataLookupSeasonEpisode,
} from "../../shared/title-parsing";
import {
	manifest as movieTmdbManifest,
	search as movieTmdbSearch,
} from "../providers/media/movie/tmdb";
import {
	manifest as showTmdbManifest,
	search as showTmdbSearch,
} from "../providers/media/show/tmdb";

export const manifest = defineManifest({
	kind: "operation",
	name: "Metadata Lookup",
	slug: "operation.metadata-lookup",
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getIntegration", "getPluginConfig", "getUserPreferences"],
});

const searchProviders = [
	{
		script: movieTmdbSearch,
		entitySchemaSlug: "movie",
		providerSlug: movieTmdbManifest.slug,
	},
	{
		script: showTmdbSearch,
		entitySchemaSlug: "show",
		providerSlug: showTmdbManifest.slug,
	},
] as const;

const notFound = { notFound: true, status: "notFound" } as const satisfies MetadataLookupResult;

export default defineOperation({
	manifest,
	input: MetadataLookupInput,
	output: MetadataLookupOutput,
	run: (input, host, execution) =>
		Effect.gen(function* () {
			const titles = input.titles.map((title) => title.trim());
			if (titles.some((title) => title === "")) {
				return yield* Effect.fail(new Error("title is required"));
			}

			const integration = yield* host.getIntegration();
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
						provider.script.run({ query, page: 1, pageSize: 20 }, host, execution).pipe(
							Effect.map(({ items }) =>
								items.map(
									(item): MetadataLookupTitleMatchCandidate => ({
										externalId: item.externalId,
										providerSlug: provider.providerSlug,
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
