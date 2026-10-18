import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Option, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { readMediaCapture } from "../../imports/collection";
import type { ImportEntityRef, MediaIntegrationAdapterResult } from "../../imports/schemas";
import { sourceFetchFailure } from "../../imports/source-helpers";
import { isValidIsbn, normalizeIsbn } from "../../lib/isbn";
import { captureIntegrationWindow } from "../artifacts";
import { integrationRecordId } from "../identity";
import { IntegrationWindowOutput, YankInput } from "../schemas";
import { baseUrl, executionStartedAt, requestJson } from "../shared";

export const manifest = defineManifest({
	kind: "script",
	name: "Audiobookshelf yank",
	slug: "integration.audiobookshelf",
});

const Metadata = Schema.Struct({
	title: Schema.String,
	asin: Schema.optional(Schema.NullOr(Schema.String)),
	isbn: Schema.optional(Schema.NullOr(Schema.String)),
	itunesId: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Int]))),
});
const Item = Schema.Struct({
	id: Schema.String,
	name: Schema.optional(Schema.String),
	recentEpisode: Schema.optional(
		Schema.NullOr(Schema.Struct({ id: Schema.String, title: Schema.String })),
	),
	media: Schema.optional(
		Schema.NullOr(
			Schema.Struct({
				metadata: Schema.optional(Schema.NullOr(Metadata)),
				ebookFormat: Schema.optional(Schema.NullOr(Schema.String)),
			}),
		),
	),
});
const Progress = Schema.Struct({
	progress: Schema.Finite,
	isFinished: Schema.Boolean,
	ebookProgress: Schema.optional(Schema.NullOr(Schema.Finite)),
});
const InProgressResponse = Schema.Struct({ libraryItems: Schema.Array(Item) });
const MeResponse = Schema.Struct({ mediaProgress: Schema.Array(Schema.Unknown) });
const LibrariesResponse = Schema.Struct({
	libraries: Schema.Array(Schema.Struct({ id: Schema.String })),
});
const ListingResponse = Schema.Struct({ results: Schema.Array(Item) });
const Cursor = Schema.Union([
	Schema.Struct({
		offset: Schema.Int,
		itemIndex: Schema.Int,
		occurredAt: Schema.String,
		items: Schema.Array(Item),
		kind: Schema.Literal("progress"),
	}),
	Schema.Struct({
		page: Schema.Int,
		offset: Schema.Int,
		itemIndex: Schema.Int,
		libraryIndex: Schema.Int,
		occurredAt: Schema.String,
		kind: Schema.Literal("ownership"),
		listing: Schema.NullOr(ListingResponse),
		libraries: Schema.NullOr(LibrariesResponse),
	}),
]);
const cursorJson = Schema.fromJsonString(Cursor);

const itemRef = (item: typeof Item.Type, ownership: boolean): null | ImportEntityRef => {
	const metadata = item.media?.metadata;
	if (!metadata) {
		return null;
	}
	const isbn = metadata.isbn ? normalizeIsbn(metadata.isbn) : "";
	const ebook = ownership && item.media.ebookFormat === "epub";
	if (!ebook) {
		const asin = metadata.asin?.trim();
		if (asin) {
			return {
				kind: "resolved",
				externalId: asin,
				sourceLabel: metadata.title,
				entitySchemaSlug: "audiobook",
				providerSlug: "audiobook.audible",
			};
		}
		const itunesId = metadata.itunesId == null ? "" : String(metadata.itunesId).trim();
		if (itunesId) {
			return {
				kind: "resolved",
				externalId: itunesId,
				sourceLabel: metadata.title,
				entitySchemaSlug: "podcast",
				providerSlug: "podcast.itunes",
			};
		}
	}
	return (!ownership || ebook) && isValidIsbn(isbn)
		? {
				kind: "unresolved",
				identifierValue: isbn,
				identifierType: "isbn",
				entitySchemaSlug: "book",
				sourceLabel: metadata.title,
			}
		: null;
};

export default defineScript({
	manifest,
	input: YankInput,
	output: IntegrationWindowOutput,
	run: (input, host, execution) =>
		Effect.gen(function* () {
			if (input.ingestionConfirmation) {
				return { chunkFiles: [], carryFile: null };
			}
			const startedAt = yield* executionStartedAt(execution);
			const integration = yield* host.getCurrentIntegration();
			const settings = asRecord(integration.providerSpecifics);
			const token = typeof settings?.["token"] === "string" ? settings["token"] : "";
			const root = baseUrl(settings?.["baseUrl"]);
			const url = root.endsWith("/api") ? root : `${root}/api`;
			const headers = { Accept: "application/json", Authorization: `Bearer ${token}` };
			const fetch = (path: string) => requestJson(host, "GET", `${url}/${path}`, { headers });
			let cursor: typeof Cursor.Type;
			if (input.ingestionArtifacts) {
				cursor = yield* Schema.decodeEffect(cursorJson)(
					new TextDecoder().decode(yield* readMediaCapture("carry")),
				);
			} else {
				const me = yield* fetch("me").pipe(Effect.flatMap(Schema.decodeUnknownEffect(MeResponse)));
				const snapshot = yield* fetch(
					`me/items-in-progress?limit=${Math.max(1, me.mediaProgress.length)}`,
				).pipe(Effect.flatMap(Schema.decodeUnknownEffect(InProgressResponse)));
				cursor = {
					offset: 0,
					itemIndex: 0,
					kind: "progress",
					occurredAt: startedAt,
					items: snapshot.libraryItems,
				};
			}
			const failures: Array<MediaIntegrationAdapterResult["failures"][number]> = [];
			const entityGroups: Array<MediaIntegrationAdapterResult["entityGroups"][number]> = [];
			let next: null | typeof Cursor.Type = null;
			let itemIndex = cursor.itemIndex;
			if (cursor.kind === "progress") {
				const item = cursor.items[cursor.offset];
				if (item) {
					const currentIndex = itemIndex++;
					const ref = itemRef(item, false);
					const episode = ref?.entitySchemaSlug === "podcast" ? item.recentEpisode : null;
					if (
						!ref ||
						(ref.entitySchemaSlug === "podcast" && (!episode?.id.trim() || !episode.title.trim()))
					) {
						let message = "Audiobookshelf item has no Audible, valid ISBN, or iTunes identifier";
						if (!item.media?.metadata) {
							message = "Audiobookshelf item is missing media metadata";
						} else if (ref?.entitySchemaSlug === "podcast") {
							message = "Audiobookshelf podcast is missing its current episode";
						}
						failures.push({
							message,
							itemIndex: currentIndex,
							sourceIdentifier: item.id,
							stage: "input_transformation",
							sourceLabel: item.media?.metadata?.title ?? item.name,
						});
					} else {
						const progressId = episode ? `${item.id}/${episode.id}` : item.id;
						const path = episode
							? `${encodeURIComponent(item.id)}/${encodeURIComponent(episode.id)}`
							: encodeURIComponent(item.id);
						const result = yield* fetch(`me/progress/${path}`).pipe(
							Effect.flatMap(Schema.decodeUnknownEffect(Progress)),
							Effect.option,
						);
						if (Option.isNone(result)) {
							failures.push(
								sourceFetchFailure({
									itemIndex: currentIndex,
									sourceIdentifier: progressId,
									sourceLabel: ref.sourceLabel,
									message: "Failed to fetch Audiobookshelf item progress",
								}),
							);
						} else {
							const progress = Math.max(result.value.progress, result.value.ebookProgress ?? 0);
							if (progress > 0 && !(progress === 1 && result.value.isFinished)) {
								entityGroups.push({
									entityRef: ref,
									itemIndex: currentIndex,
									collectionMemberships: [],
									events: [
										{
											eventSchemaSlug: "progress",
											occurredAt: cursor.occurredAt,
											properties: { consumedOn: "Audiobookshelf", progressPercent: progress * 100 },
											...(episode
												? {
														unresolvedEpisode: {
															episodeTitle: episode.title,
															type: "podcast-title" as const,
														},
													}
												: {}),
											attribution: {
												sourceIdentifier: progressId,
												sourceLabel: ref.sourceLabel,
												recordId: integrationRecordId(["audiobookshelf", progressId]),
											},
										},
									],
								});
							}
						}
					}
				}
				if (cursor.offset + 1 < cursor.items.length) {
					next = { ...cursor, itemIndex, offset: cursor.offset + 1 };
				} else if (integration.syncOwnership) {
					next = {
						page: 0,
						itemIndex,
						offset: 0,
						listing: null,
						libraryIndex: 0,
						libraries: null,
						kind: "ownership",
						occurredAt: cursor.occurredAt,
					};
				}
			} else {
				const libraries =
					cursor.libraries ??
					(yield* fetch("libraries").pipe(
						Effect.flatMap(Schema.decodeUnknownEffect(LibrariesResponse)),
					));
				const library = libraries.libraries[cursor.libraryIndex];
				if (library) {
					const result = cursor.listing
						? Option.some(cursor.listing)
						: yield* fetch(
								`libraries/${encodeURIComponent(library.id)}/items?expanded=1&limit=100&page=${cursor.page}`,
							).pipe(Effect.flatMap(Schema.decodeUnknownEffect(ListingResponse)), Effect.option);
					if (Option.isNone(result)) {
						failures.push(
							sourceFetchFailure({
								itemIndex: itemIndex++,
								sourceIdentifier: library.id,
								message: "Failed to fetch Audiobookshelf library items",
							}),
						);
					}
					const listing = Option.getOrElse(result, () => ({ results: [] }));
					const item = listing.results[cursor.offset];
					if (item) {
						const currentIndex = itemIndex++;
						const ref = itemRef(item, true);
						if (ref) {
							entityGroups.push({
								events: [],
								entityRef: ref,
								itemIndex: currentIndex,
								collectionMemberships: [],
								ownershipProvider: "audiobookshelf",
							});
						}
					}
					if (cursor.offset + 1 < listing.results.length) {
						next = { ...cursor, listing, libraries, itemIndex, offset: cursor.offset + 1 };
					} else if (listing.results.length === 100) {
						next = {
							...cursor,
							libraries,
							itemIndex,
							offset: 0,
							listing: null,
							page: cursor.page + 1,
						};
					} else if (cursor.libraryIndex + 1 < libraries.libraries.length) {
						next = {
							...cursor,
							page: 0,
							libraries,
							itemIndex,
							offset: 0,
							listing: null,
							libraryIndex: cursor.libraryIndex + 1,
						};
					}
				}
			}
			return yield* captureIntegrationWindow(
				manifest.slug,
				{ failures, entityGroups },
				next ? yield* Schema.encodeEffect(cursorJson)(next) : null,
			);
		}),
});
