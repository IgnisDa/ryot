import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Option, Schema } from "@ryot-app/sandbox-sdk/effect";

import { readMediaCapture } from "../../imports/collection";
import type { ImportEntityRef, MediaIntegrationAdapterResult } from "../../imports/schemas";
import { sourceFetchFailure } from "../../imports/source-helpers";
import { captureIntegrationWindow } from "../artifacts";
import { integrationRecordId } from "../identity";
import { IntegrationWindowOutput, YankInput } from "../schemas";
import { baseUrl, executionStartedAt, requestJson, specifics } from "../shared";

export const manifest = defineManifest({
	kind: "script",
	name: "Audiobookshelf yank",
	slug: "integration.audiobookshelf",
});

const Metadata = Schema.Struct({
	title: Schema.String,
	asin: Schema.optional(Schema.NullOr(Schema.String)),
	isbn: Schema.optional(Schema.NullOr(Schema.String)),
	itunesId: Schema.optional(Schema.NullOr(Schema.String)),
});

const Episode = Schema.Struct({
	id: Schema.optional(Schema.String),
	index: Schema.optional(Schema.NullOr(Schema.Finite)),
	number: Schema.optional(Schema.NullOr(Schema.Finite)),
	sequence: Schema.optional(Schema.NullOr(Schema.Finite)),
	episodeNumber: Schema.optional(Schema.NullOr(Schema.Finite)),
	episode: Schema.optional(Schema.NullOr(Schema.Union([Schema.Finite, Schema.String]))),
});

const MediaProgress = Schema.Struct({
	episodeId: Schema.optional(Schema.NullOr(Schema.String)),
	isFinished: Schema.optional(Schema.NullOr(Schema.Boolean)),
	libraryItemId: Schema.optional(Schema.NullOr(Schema.String)),
});

const MeResponse = Schema.Struct({
	mediaProgress: Schema.optional(Schema.NullOr(Schema.Array(MediaProgress))),
});

const Item = Schema.Struct({
	id: Schema.String,
	name: Schema.optional(Schema.String),
	mediaType: Schema.optional(Schema.Literals(["book", "podcast"])),
	media: Schema.optional(
		Schema.Struct({
			metadata: Schema.optional(Metadata),
			episodes: Schema.optional(Schema.Array(Episode)),
			ebookFormat: Schema.optional(Schema.NullOr(Schema.String)),
		}),
	),
});

const LibrariesResponse = Schema.Struct({
	libraries: Schema.optional(
		Schema.Array(
			Schema.Struct({
				id: Schema.String,
				name: Schema.optional(Schema.String),
				mediaType: Schema.optional(Schema.Literals(["book", "podcast"])),
			}),
		),
	),
});

const ListingResponse = Schema.Struct({ results: Schema.optional(Schema.Array(Item)) });

const DetailsResponse = Schema.Struct({
	media: Schema.optional(Schema.Struct({ episodes: Schema.optional(Schema.Array(Episode)) })),
});
const Cursor = Schema.Struct({
	offset: Schema.Int,
	itemIndex: Schema.Int,
	libraryIndex: Schema.Int,
	importedAt: Schema.String,
	ownership: Schema.Boolean,
	episodeOffset: Schema.Int,
	libraries: LibrariesResponse,
	listing: Schema.NullOr(ListingResponse),
	details: Schema.NullOr(DetailsResponse),
	finishedEpisodes: Schema.Array(Schema.String),
});
const cursorJson = Schema.fromJsonString(Cursor);

const validIsbn = (value: string) => {
	if (/^\d{13}$/.test(value)) {
		const sum = value
			.slice(0, 12)
			.split("")
			.reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
		return (sum + Number(value[12])) % 10 === 0;
	}
	if (/^\d{9}[\dX]$/.test(value)) {
		const sum = value.split("").reduce((total, digit, index) => {
			const number = digit === "X" ? 10 : Number(digit);
			return total + number * (10 - index);
		}, 0);
		return sum % 11 === 0;
	}
	return false;
};

const itemRef = (item: typeof Item.Type): ImportEntityRef | null => {
	const metadata = item.media?.metadata;
	if (!metadata) {
		return null;
	}
	if (item.media.ebookFormat === "epub" && typeof metadata.isbn === "string") {
		const isbn = metadata.isbn.replace(/[^0-9X]/gi, "").toUpperCase();
		if (validIsbn(isbn)) {
			return {
				kind: "unresolved",
				identifierValue: isbn,
				identifierType: "isbn",
				entitySchemaSlug: "book",
				sourceLabel: metadata.title,
			};
		}
	}
	if (typeof metadata.asin === "string" && metadata.asin.trim()) {
		return {
			kind: "resolved",
			sourceLabel: metadata.title,
			entitySchemaSlug: "audiobook",
			externalId: metadata.asin.trim(),
			providerSlug: "audiobook.audible",
		};
	}
	if (typeof metadata.itunesId === "string" && metadata.itunesId.trim()) {
		return {
			kind: "resolved",
			sourceLabel: metadata.title,
			entitySchemaSlug: "podcast",
			providerSlug: "podcast.itunes",
			externalId: metadata.itunesId.trim(),
		};
	}
	return null;
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
			const settings = specifics(integration.providerSpecifics);
			const token = typeof settings?.["token"] === "string" ? settings["token"] : "";
			const root = baseUrl(settings?.["baseUrl"]);
			const url = root.endsWith("/api") ? root : `${root}/api`;
			const headers = { Accept: "application/json", Authorization: `Bearer ${token}` };
			const cursor = input.ingestionArtifacts
				? yield* Schema.decodeEffect(cursorJson)(
						new TextDecoder().decode(yield* readMediaCapture("carry")),
					)
				: {
						offset: 0,
						itemIndex: 0,
						listing: null,
						details: null,
						libraryIndex: 0,
						ownership: false,
						episodeOffset: 0,
						importedAt: startedAt,
						libraries: yield* requestJson(host, "GET", `${url}/libraries`, { headers }).pipe(
							Effect.flatMap(Schema.decodeUnknownEffect(LibrariesResponse)),
						),
						finishedEpisodes: (
							(yield* requestJson(host, "GET", `${url}/me`, { headers }).pipe(
								Effect.flatMap(Schema.decodeUnknownEffect(MeResponse)),
							)).mediaProgress ?? []
						)
							.filter((entry) => entry.isFinished && entry.episodeId)
							.map((entry) => `${entry.libraryItemId}:${entry.episodeId}`),
					};
			const finishedEpisodes = new Set(cursor.finishedEpisodes);
			const importedAt = cursor.importedAt;
			const failures: Array<MediaIntegrationAdapterResult["failures"][number]> = [];
			const entityGroups: Array<MediaIntegrationAdapterResult["entityGroups"][number]> = [];
			let itemIndex = cursor.itemIndex;
			let offset = cursor.offset;
			let listing = cursor.listing;
			let details = cursor.details;
			let episodeOffset = cursor.episodeOffset;
			for (const library of (cursor.libraries.libraries ?? []).slice(
				cursor.libraryIndex,
				cursor.libraryIndex + 1,
			)) {
				const filter =
					!cursor.ownership && library.mediaType === "book" ? "&filter=progress.ZmluaXNoZWQ=" : "";
				const listingResult = listing
					? Option.some(listing)
					: yield* requestJson(
							host,
							"GET",
							`${url}/libraries/${library.id}/items?expanded=1${filter}`,
							{ headers },
						).pipe(Effect.flatMap(Schema.decodeUnknownEffect(ListingResponse)), Effect.option);
				if (Option.isNone(listingResult) && !cursor.ownership) {
					failures.push(
						sourceFetchFailure({
							itemIndex,
							sourceLabel: library.name,
							sourceIdentifier: library.id,
							message: "Failed to fetch Audiobookshelf library items",
						}),
					);
				}
				listing = Option.getOrElse(listingResult, () => ({ results: [] }));
				for (const item of (listing.results ?? []).slice(offset, offset + 1)) {
					offset++;
					const currentIndex = itemIndex++;
					const ref = itemRef(item);
					if (cursor.ownership) {
						if (ref) {
							entityGroups.push({
								events: [],
								entityRef: ref,
								itemIndex: currentIndex,
								collectionMemberships: [],
								ownershipProvider: "audiobookshelf",
							});
						}
						continue;
					}
					if (!ref) {
						let message = "Audiobookshelf item is missing media metadata";
						if (item.media?.metadata) {
							message =
								item.media.ebookFormat === "epub"
									? "Audiobookshelf ebook is missing a valid ISBN"
									: "Audiobookshelf item has no Audible, ISBN, or iTunes identifier";
						}
						failures.push({
							message,
							itemIndex: currentIndex,
							sourceIdentifier: item.id,
							stage: "input_transformation",
							sourceLabel: item.media?.metadata?.title ?? item.name,
						});
						continue;
					}
					const events: Array<
						MediaIntegrationAdapterResult["entityGroups"][number]["events"][number]
					> = [];
					const occurredAt = importedAt;
					if (ref.entitySchemaSlug !== "podcast") {
						events.push({
							occurredAt,
							eventSchemaSlug: "complete",
							properties: { completedOn: occurredAt, completionMode: "custom_timestamps" },
							attribution: {
								sourceIdentifier: item.id,
								sourceLabel: ref.sourceLabel,
								recordId: integrationRecordId(["audiobookshelf", item.id]),
							},
						});
					} else {
						const detailsResult = details
							? Option.some(details)
							: yield* requestJson(
									host,
									"GET",
									`${url}/items/${item.id}?expanded=1&include=progress`,
									{ headers },
								).pipe(Effect.flatMap(Schema.decodeUnknownEffect(DetailsResponse)), Effect.option);
						if (Option.isNone(detailsResult)) {
							failures.push(
								sourceFetchFailure({
									itemIndex: currentIndex,
									sourceIdentifier: item.id,
									sourceLabel: ref.sourceLabel,
									message: "Failed to fetch Audiobookshelf podcast details",
								}),
							);
						}
						details = Option.getOrNull(detailsResult);
						for (const [eventIndex, episode] of (details?.media?.episodes ?? [])
							.slice(episodeOffset, episodeOffset + 128)
							.entries()) {
							if (!episode.id || !finishedEpisodes.has(`${item.id}:${episode.id}`)) {
								continue;
							}
							const number =
								episode.episodeNumber ??
								episode.number ??
								episode.index ??
								episode.sequence ??
								(typeof episode.episode === "number"
									? episode.episode
									: Number.parseInt(episode.episode ?? "", 10));
							if (!Number.isInteger(number)) {
								failures.push({
									itemIndex: currentIndex,
									sourceIdentifier: episode.id,
									sourceLabel: ref.sourceLabel,
									stage: "input_transformation",
									message: "Audiobookshelf podcast episode is finished but has no episode number",
								});
								continue;
							}
							events.push({
								occurredAt,
								eventSchemaSlug: "progress",
								properties: { progressPercent: 100 },
								unresolvedEpisode: { type: "podcast", episodeNumber: number },
								operationId: integrationRecordId([
									"integration-audiobookshelf-event",
									currentIndex,
									episodeOffset + eventIndex,
								]),
								attribution: {
									sourceIdentifier: episode.id,
									sourceLabel: ref.sourceLabel,
									recordId: integrationRecordId(["audiobookshelf-episode", item.id, episode.id]),
								},
							});
						}
						episodeOffset += 128;
						if (episodeOffset < (details?.media?.episodes?.length ?? 0)) {
							offset--;
							itemIndex--;
						} else {
							details = null;
							episodeOffset = 0;
						}
					}
					if (events.length) {
						entityGroups.push({
							events,
							entityRef: ref,
							itemIndex: currentIndex,
							collectionMemberships: library.name?.trim()
								? [{ collectionName: library.name.trim() }]
								: [],
						});
					}
				}
			}
			const libraryDone = !listing || offset >= (listing.results?.length ?? 0);
			let next: typeof Cursor.Type | null = {
				...cursor,
				offset,
				listing,
				details,
				itemIndex,
				episodeOffset,
			};
			if (libraryDone) {
				next = null;
				if (!cursor.ownership && integration.syncOwnership) {
					next = {
						...cursor,
						itemIndex,
						offset: 0,
						listing: null,
						details: null,
						ownership: true,
						episodeOffset: 0,
					};
				} else if (cursor.libraryIndex + 1 < (cursor.libraries.libraries?.length ?? 0)) {
					next = {
						...cursor,
						itemIndex,
						offset: 0,
						listing: null,
						details: null,
						ownership: false,
						episodeOffset: 0,
						libraryIndex: cursor.libraryIndex + 1,
					};
				}
			}
			return yield* captureIntegrationWindow(
				manifest.slug,
				{ failures, entityGroups },
				next ? yield* Schema.encodeEffect(cursorJson)(next) : null,
				cursor.episodeOffset,
			);
		}),
});
