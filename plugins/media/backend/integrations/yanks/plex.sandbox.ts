import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { DateTime, Effect, Option, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { readMediaCapture } from "../../imports/collection";
import { ImportEntityRef, type MediaIntegrationAdapterResult } from "../../imports/schemas";
import { movieOrShowImportRef, sourceFetchFailure } from "../../imports/source-helpers";
import { captureIntegrationWindow } from "../artifacts";
import { integrationRecordId } from "../identity";
import { IntegrationWindowOutput, YankInput } from "../schemas";
import { baseUrl, requestJson } from "../shared";

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
const Listing = Schema.Struct({
	offset: Schema.Int,
	snapshot: ItemsResponse,
	phase: Schema.Literal("listing"),
});
const Cursor = Schema.Struct({
	itemIndex: Schema.Int,
	directoryIndex: Schema.Int,
	directories: Schema.Array(Directory),
	continuation: Schema.Union([
		Schema.Struct({ phase: Schema.Literal("directory") }),
		Listing,
		Schema.Struct({
			resume: Listing,
			itemIndex: Schema.Int,
			leaves: ItemsResponse,
			leafOffset: Schema.Int,
			entityRef: ImportEntityRef,
			sourceIdentifier: Schema.String,
			phase: Schema.Literal("episodes"),
		}),
	]),
});
const cursorJson = Schema.fromJsonString(Cursor);

const refFor = (item: typeof Item.Type, lot: "show" | "movie"): null | ImportEntityRef => {
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
			const settings = asRecord(integration.providerSpecifics);
			const token = typeof settings?.["token"] === "string" ? settings["token"] : "";
			const url = baseUrl(settings?.["baseUrl"]);
			const headers = { "X-Plex-Token": token, Accept: "application/json" };
			const cursor: typeof Cursor.Type = input.ingestionArtifacts
				? yield* Schema.decodeEffect(cursorJson)(
						new TextDecoder().decode(yield* readMediaCapture("carry")),
					)
				: {
						itemIndex: 0,
						directoryIndex: 0,
						continuation: { phase: "directory" },
						directories:
							(yield* requestJson(host, "GET", `${url}/library/sections`, { headers }).pipe(
								Effect.flatMap(Schema.decodeUnknownEffect(LibrariesResponse)),
							)).MediaContainer?.Directory ?? [],
					};
			const failures: Array<MediaIntegrationAdapterResult["failures"][number]> = [];
			const entityGroups: Array<MediaIntegrationAdapterResult["entityGroups"][number]> = [];
			let itemIndex = cursor.itemIndex;
			let continuation = cursor.continuation;
			let eventIndexBase = 0;
			const finishItem = (entityRef: ImportEntityRef, currentIndex: number) => {
				if (integration.syncOwnership) {
					entityGroups.push({
						entityRef,
						events: [],
						itemIndex: currentIndex,
						collectionMemberships: [],
						ownershipProvider: "plex_yank",
					});
				}
			};
			const directory = cursor.directories[cursor.directoryIndex];
			if (directory && (directory.type === "movie" || directory.type === "show")) {
				if (continuation.phase === "directory") {
					const listingResult = yield* requestJson(
						host,
						"GET",
						`${url}/library/sections/${directory.key}/all?includeGuids=1`,
						{ headers },
					).pipe(Effect.flatMap(Schema.decodeUnknownEffect(ItemsResponse)), Effect.option);
					if (Option.isNone(listingResult)) {
						failures.push(
							sourceFetchFailure({
								itemIndex: itemIndex++,
								sourceLabel: String(directory.key),
								sourceIdentifier: String(directory.key),
								message: "Failed to fetch Plex library items",
							}),
						);
					} else {
						continuation = { offset: 0, phase: "listing", snapshot: listingResult.value };
					}
				}
				if (continuation.phase === "listing") {
					const item = continuation.snapshot.MediaContainer?.Metadata?.[continuation.offset];
					if (item) {
						continuation = { ...continuation, offset: continuation.offset + 1 };
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
						if (ref) {
							const events: Array<
								MediaIntegrationAdapterResult["entityGroups"][number]["events"][number]
							> = [];
							if (directory.type === "movie" && item.lastViewedAt) {
								const timestamp = Number(item.lastViewedAt);
								if (Number.isFinite(timestamp)) {
									const occurredAt = DateTime.formatIso(DateTime.makeUnsafe(timestamp * 1_000));
									events.push({
										occurredAt,
										properties: {},
										eventSchemaSlug: "complete",
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
								const leavesResult = yield* requestJson(
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
									continuation = {
										leafOffset: 0,
										entityRef: ref,
										phase: "episodes",
										resume: continuation,
										itemIndex: currentIndex,
										leaves: leavesResult.value,
										sourceIdentifier: String(item.key ?? currentIndex),
									};
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
							if (continuation.phase !== "episodes") {
								finishItem(ref, currentIndex);
							}
						}
					}
				}
				if (continuation.phase === "episodes") {
					const active = continuation;
					eventIndexBase = active.leafOffset;
					const events: Array<
						MediaIntegrationAdapterResult["entityGroups"][number]["events"][number]
					> = [];
					for (const [eventIndex, leaf] of (active.leaves.MediaContainer?.Metadata ?? [])
						.slice(active.leafOffset, active.leafOffset + 128)
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
									active.itemIndex,
									active.leafOffset + eventIndex,
								]),
								attribution: {
									sourceLabel: leaf.title,
									sourceIdentifier: String(leaf.ratingKey ?? leaf.key ?? active.sourceIdentifier),
									recordId: integrationRecordId([
										"plex-leaf",
										leaf.ratingKey ?? leaf.key ?? active.leafOffset + eventIndex,
									]),
								},
							});
						}
					}
					if (events.length) {
						entityGroups.push({
							events,
							collectionMemberships: [],
							entityRef: active.entityRef,
							itemIndex: active.itemIndex,
						});
					}
					const leafOffset = active.leafOffset + 128;
					if (leafOffset < (active.leaves.MediaContainer?.Metadata?.length ?? 0)) {
						continuation = { ...active, leafOffset };
					} else {
						finishItem(active.entityRef, active.itemIndex);
						continuation = active.resume;
					}
				}
			}
			let next: null | typeof Cursor.Type = null;
			if (
				continuation.phase === "episodes" ||
				(continuation.phase === "listing" &&
					continuation.offset < (continuation.snapshot.MediaContainer?.Metadata?.length ?? 0))
			) {
				next = { ...cursor, itemIndex, continuation };
			} else if (cursor.directoryIndex + 1 < cursor.directories.length) {
				next = {
					...cursor,
					itemIndex,
					continuation: { phase: "directory" },
					directoryIndex: cursor.directoryIndex + 1,
				};
			}
			return yield* captureIntegrationWindow(
				manifest.slug,
				{ failures, entityGroups },
				next ? yield* Schema.encodeEffect(cursorJson)(next) : null,
				eventIndexBase,
			);
		}),
});
