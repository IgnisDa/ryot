import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { DateTime, Effect, Option, Schema } from "@ryot-app/sandbox-sdk/effect";

import { readMediaCapture } from "../../imports/collection";
import type { ImportEntityRef, MediaIntegrationAdapterResult } from "../../imports/schemas";
import { movieOrShowImportRef, sourceFetchFailure } from "../../imports/source-helpers";
import { captureIntegrationWindow } from "../artifacts";
import { integrationRecordId } from "../identity";
import { IntegrationWindowOutput, YankInput } from "../schemas";
import { baseUrl, requestJson, specifics } from "../shared";

export const manifest = defineManifest({
	kind: "script",
	name: "Plex yank",
	slug: "integration.plex-yank",
});

const StringOrNumber = Schema.Union([Schema.String, Schema.Finite]);

const Item = Schema.Struct({
	title: Schema.String,
	key: Schema.optional(Schema.String),
	index: Schema.optional(Schema.Finite),
	ratingKey: Schema.optional(StringOrNumber),
	parentIndex: Schema.optional(Schema.Finite),
	lastViewedAt: Schema.optional(StringOrNumber),
	Guid: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String }))),
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
const Directory = Schema.Struct({ key: StringOrNumber, type: Schema.String });
const Cursor = Schema.Struct({
	offset: Schema.Int,
	itemIndex: Schema.Int,
	leafOffset: Schema.Int,
	directoryIndex: Schema.Int,
	directories: Schema.Array(Directory),
	leaves: Schema.NullOr(ItemsResponse),
	listing: Schema.NullOr(ItemsResponse),
});
const cursorJson = Schema.fromJsonString(Cursor);

const refFor = (item: typeof Item.Type, lot: "movie" | "show"): ImportEntityRef | null => {
	const ids = Object.fromEntries((item.Guid ?? []).map(({ id }) => id.split("://")));
	return movieOrShowImportRef({
		entitySchemaSlug: lot,
		sourceLabel: item.title,
		providerIds: { imdb: ids["imdb"], tmdb: ids["tmdb"], tvdb: ids["tvdb"] },
	});
};

export default defineScript({
	manifest,
	input: YankInput,
	output: IntegrationWindowOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			if (input.ingestionConfirmation) {
				return { chunkFiles: [], carryFile: null };
			}
			const integration = yield* host.getCurrentIntegration();
			const settings = specifics(integration.providerSpecifics);
			const token = typeof settings?.["token"] === "string" ? settings["token"] : "";
			const url = baseUrl(settings?.["baseUrl"]);
			const headers = { "X-Plex-Token": token, Accept: "application/json" };
			const cursor = input.ingestionArtifacts
				? yield* Schema.decodeEffect(cursorJson)(
						new TextDecoder().decode(yield* readMediaCapture("carry")),
					)
				: {
						offset: 0,
						itemIndex: 0,
						leaves: null,
						listing: null,
						leafOffset: 0,
						directoryIndex: 0,
						directories:
							(yield* requestJson(host, "GET", `${url}/library/sections`, { headers }).pipe(
								Effect.flatMap(Schema.decodeUnknownEffect(LibrariesResponse)),
							)).MediaContainer?.Directory ?? [],
					};
			const failures: Array<MediaIntegrationAdapterResult["failures"][number]> = [];
			const entityGroups: Array<MediaIntegrationAdapterResult["entityGroups"][number]> = [];
			let itemIndex = cursor.itemIndex;
			let listing = cursor.listing;
			let leaves = cursor.leaves;
			let leafOffset = cursor.leafOffset;
			let offset = cursor.offset;
			for (const directory of cursor.directories.slice(
				cursor.directoryIndex,
				cursor.directoryIndex + 1,
			)) {
				if (directory.type !== "movie" && directory.type !== "show") {
					continue;
				}
				const listingResult = listing
					? Option.some(listing)
					: yield* requestJson(
							host,
							"GET",
							`${url}/library/sections/${directory.key}/all?includeGuids=1`,
							{ headers },
						).pipe(Effect.flatMap(Schema.decodeUnknownEffect(ItemsResponse)), Effect.option);
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
				listing = listingResult.value;
				for (const item of (listing.MediaContainer?.Metadata ?? []).slice(offset, offset + 1)) {
					offset++;
					const ref = refFor(item, directory.type);
					const currentIndex = itemIndex;
					itemIndex++;
					if (!ref && item.lastViewedAt) {
						failures.push({
							itemIndex: currentIndex,
							sourceLabel: item.title,
							sourceIdentifier: item.key,
							stage: "input_transformation",
							message: "Plex item has no TMDB, TVDB, or IMDb identifier",
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
							const occurredAt = DateTime.formatIso(DateTime.makeUnsafe(timestamp * 1_000));
							events.push({
								occurredAt,
								eventSchemaSlug: "complete",
								properties: { completedOn: occurredAt, completionMode: "custom_timestamps" },
								attribution: {
									sourceLabel: item.title,
									sourceIdentifier: String(item.ratingKey ?? item.key ?? currentIndex),
									recordId: integrationRecordId([
										"plex-item",
										item.ratingKey ?? item.key ?? currentIndex,
									]),
								},
							});
						}
					}
					if (directory.type === "show" && item.lastViewedAt && !item.ratingKey) {
						failures.push({
							itemIndex: currentIndex,
							sourceLabel: item.title,
							sourceIdentifier: item.key,
							stage: "input_transformation",
							message: "Plex show has no rating key",
						});
					}
					if (directory.type === "show" && item.lastViewedAt && item.ratingKey) {
						const leavesResult = leaves
							? Option.some(leaves)
							: yield* requestJson(
									host,
									"GET",
									`${url}/library/metadata/${item.ratingKey}/allLeaves`,
									{ headers },
								).pipe(Effect.flatMap(Schema.decodeUnknownEffect(ItemsResponse)), Effect.option);
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
							leaves = leavesResult.value;
							for (const [eventIndex, leaf] of (leaves.MediaContainer?.Metadata ?? [])
								.slice(leafOffset, leafOffset + 128)
								.entries()) {
								if (leaf.lastViewedAt && leaf.parentIndex != null && leaf.index != null) {
									const timestamp = Number(leaf.lastViewedAt);
									if (!Number.isFinite(timestamp)) {
										continue;
									}
									events.push({
										eventSchemaSlug: "progress",
										properties: { progressPercent: 100 },
										occurredAt: DateTime.formatIso(DateTime.makeUnsafe(timestamp * 1_000)),
										unresolvedEpisode: {
											type: "show",
											episodeNumber: leaf.index,
											seasonNumber: leaf.parentIndex,
										},
										operationId: integrationRecordId([
											"integration-plex-event",
											currentIndex,
											leafOffset + eventIndex,
										]),
										attribution: {
											sourceLabel: leaf.title,
											sourceIdentifier: String(
												leaf.ratingKey ?? leaf.key ?? item.key ?? currentIndex,
											),
											recordId: integrationRecordId([
												"plex-leaf",
												leaf.ratingKey ?? leaf.key ?? leafOffset + eventIndex,
											]),
										},
									});
								}
							}
							leafOffset += 128;
							if (leafOffset < (leaves.MediaContainer?.Metadata?.length ?? 0)) {
								offset--;
								itemIndex--;
							} else {
								leaves = null;
								leafOffset = 0;
							}
						}
					}
					if (events.length) {
						entityGroups.push({
							events,
							entityRef: ref,
							itemIndex: currentIndex,
							collectionMemberships: [],
						});
					}
					if (integration.syncOwnership && !leaves) {
						entityGroups.push({
							events: [],
							entityRef: ref,
							itemIndex: currentIndex,
							collectionMemberships: [],
							ownershipProvider: "plex_yank",
						});
					}
				}
			}
			const directoryDone = !listing || offset >= (listing.MediaContainer?.Metadata?.length ?? 0);
			let next: typeof Cursor.Type | null = {
				...cursor,
				leaves,
				offset,
				listing,
				itemIndex,
				leafOffset,
			};
			if (directoryDone) {
				next = null;
				if (cursor.directoryIndex + 1 < cursor.directories.length) {
					next = {
						...cursor,
						itemIndex,
						offset: 0,
						leaves: null,
						listing: null,
						leafOffset: 0,
						directoryIndex: cursor.directoryIndex + 1,
					};
				}
			}
			return yield* captureIntegrationWindow(
				manifest.slug,
				{ failures, entityGroups },
				next ? yield* Schema.encodeEffect(cursorJson)(next) : null,
				cursor.leafOffset,
			);
		}),
});
