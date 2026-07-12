import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Option, Schema } from "@ryot/sandbox-sdk/effect";

import type { ImportEntityRef } from "../../../imports/schemas";
import { MediaIntegrationAdapterResult } from "../../../imports/schemas";
import { movieOrShowImportRef, sourceFetchFailure } from "../../../imports/source-helpers";
import { baseUrl, requestJson, specifics } from "../shared";

export const manifest = defineManifest({
	kind: "script",
	name: "Plex yank",
	slug: "integration.plex-yank",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getIntegration"],
});
const Input = Schema.Struct({});
const StringOrNumber = Schema.Union(Schema.String, Schema.Number);
const Item = Schema.Struct({
	title: Schema.String,
	Guid: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String }))),
	key: Schema.optional(Schema.String),
	index: Schema.optional(Schema.Number),
	ratingKey: Schema.optional(StringOrNumber),
	parentIndex: Schema.optional(Schema.Number),
	lastViewedAt: Schema.optional(StringOrNumber),
});
const MediaContainer = Schema.Struct({ Metadata: Schema.optional(Schema.Array(Item)) });
const LibrariesResponse = Schema.Struct({
	MediaContainer: Schema.optional(
		Schema.Struct({
			Directory: Schema.optional(
				Schema.Array(Schema.Struct({ key: StringOrNumber, type: Schema.String })),
			),
		}),
	),
});
const ItemsResponse = Schema.Struct({ MediaContainer: Schema.optional(MediaContainer) });
const refFor = (item: typeof Item.Type, lot: "movie" | "show"): ImportEntityRef | null => {
	const ids = Object.fromEntries((item.Guid ?? []).map(({ id }) => id.split("://")));
	return movieOrShowImportRef({
		sourceLabel: item.title,
		entitySchemaSlug: lot,
		providerIds: { imdb: ids["imdb"], tmdb: ids["tmdb"], tvdb: ids["tvdb"] },
	});
};
export default defineScript({
	manifest,
	input: Input,
	output: MediaIntegrationAdapterResult,
	run: (_input, host) =>
		Effect.gen(function* () {
			const integration = yield* host.getIntegration();
			const settings = specifics(integration.providerSpecifics);
			const token = typeof settings?.["token"] === "string" ? settings["token"] : "";
			const url = baseUrl(settings?.["baseUrl"]);
			const headers = { Accept: "application/json", "X-Plex-Token": token };
			const libraries = yield* requestJson(host, "GET", `${url}/library/sections`, {
				headers,
			}).pipe(Effect.flatMap(Schema.decodeUnknown(LibrariesResponse)));
			const failures: Array<MediaIntegrationAdapterResult["failures"][number]> = [];
			const entityGroups: Array<MediaIntegrationAdapterResult["entityGroups"][number]> = [];
			let itemIndex = 0;
			for (const directory of libraries.MediaContainer?.Directory ?? []) {
				if (directory.type !== "movie" && directory.type !== "show") {
					continue;
				}
				const listingResult = yield* requestJson(
					host,
					"GET",
					`${url}/library/sections/${directory.key}/all?includeGuids=1`,
					{ headers },
				).pipe(Effect.flatMap(Schema.decodeUnknown(ItemsResponse)), Effect.option);
				if (Option.isNone(listingResult)) {
					failures.push(
						sourceFetchFailure({
							itemIndex,
							sourceLabel: String(directory.key),
							sourceIdentifier: String(directory.key),
							message: "Failed to fetch Plex library items",
						}),
					);
					continue;
				}
				const listing = listingResult.value;
				for (const item of listing.MediaContainer?.Metadata ?? []) {
					const ref = refFor(item, directory.type);
					const currentIndex = itemIndex++;
					if (!ref && item.lastViewedAt) {
						failures.push({
							itemIndex: currentIndex,
							stage: "input_transformation",
							message: "Plex item has no TMDB, TVDB, or IMDb identifier",
							sourceLabel: item.title,
							sourceIdentifier: item.key,
						});
					}
					if (!ref) {
						continue;
					}
					const events: Array<
						MediaIntegrationAdapterResult["entityGroups"][number]["events"][number]
					> = [];
					if (directory.type === "movie" && item.lastViewedAt) {
						const timestamp = Number(item.lastViewedAt);
						if (Number.isFinite(timestamp)) {
							const occurredAt = new Date(timestamp * 1_000).toISOString();
							events.push({
								occurredAt,
								eventSchemaSlug: "complete",
								properties: { completedOn: occurredAt, completionMode: "custom_timestamps" },
							});
						}
					}
					if (directory.type === "show" && item.lastViewedAt && !item.ratingKey) {
						failures.push({
							itemIndex: currentIndex,
							stage: "input_transformation",
							message: "Plex show has no rating key",
							sourceLabel: item.title,
							sourceIdentifier: item.key,
						});
					}
					if (directory.type === "show" && item.lastViewedAt && item.ratingKey) {
						const leavesResult = yield* requestJson(
							host,
							"GET",
							`${url}/library/metadata/${item.ratingKey}/allLeaves`,
							{ headers },
						).pipe(Effect.flatMap(Schema.decodeUnknown(ItemsResponse)), Effect.option);
						if (Option.isNone(leavesResult)) {
							failures.push(
								sourceFetchFailure({
									itemIndex: currentIndex,
									sourceLabel: item.title,
									sourceIdentifier: item.key,
									message: "Failed to fetch watched episodes from Plex",
								}),
							);
						} else {
							for (const leaf of leavesResult.value.MediaContainer?.Metadata ?? []) {
								if (leaf.lastViewedAt && leaf.parentIndex != null && leaf.index != null) {
									const timestamp = Number(leaf.lastViewedAt);
									if (!Number.isFinite(timestamp)) {
										continue;
									}
									events.push({
										occurredAt: new Date(timestamp * 1_000).toISOString(),
										eventSchemaSlug: "progress",
										properties: { progressPercent: 100 },
										unresolvedEpisode: {
											type: "show",
											seasonNumber: leaf.parentIndex,
											episodeNumber: leaf.index,
										},
									});
								}
							}
						}
					}
					if (events.length) {
						entityGroups.push({
							entityRef: ref,
							events,
							itemIndex: currentIndex,
							collectionMemberships: [],
						});
					}
					if (integration.syncOwnership) {
						entityGroups.push({
							entityRef: ref,
							events: [],
							ownershipProvider: "plex_yank",
							itemIndex: currentIndex,
							collectionMemberships: [],
						});
					}
				}
			}
			return { failures, entityGroups };
		}),
});
