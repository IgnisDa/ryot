import { Effect, Either, Schema } from "effect";

import {
	addCollectionMembership,
	createCompleteEvent,
	finalizeEntityGroups,
	isValidIsbn,
	normalizeIsbn,
} from "../../media/adapter-helpers";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/adapter-result";
import { nowIso } from "../../media/dates";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type { ImportEntityRef, ImportMediaEntityGroup } from "../../media/types";
import { requestSourceJson } from "../../runtime/source-api";
import { createSourceFetchFailure, isNotNullAdapterFailure } from "../shared/adapter-utils";

const AUDIOBOOKSHELF_CONCURRENCY = 5;
const FINISHED_FILTER = Buffer.from("finished", "utf8").toString("base64");

const AudiobookshelfLibrary = Schema.Struct({
	id: Schema.String,
	name: Schema.optional(Schema.String),
	mediaType: Schema.optional(Schema.Literal("book", "podcast")),
});

const AudiobookshelfProgress = Schema.optional(
	Schema.Struct({
		progress: Schema.optional(Schema.Number),
		isFinished: Schema.optional(Schema.Boolean),
		ebookProgress: Schema.optional(Schema.Number),
	}),
);

const AudiobookshelfEpisode = Schema.Struct({
	title: Schema.String,
	id: Schema.optional(Schema.String),
	index: Schema.optional(Schema.Int),
	number: Schema.optional(Schema.Int),
	sequence: Schema.optional(Schema.Int),
	episodeNumber: Schema.optional(Schema.Int),
	episode: Schema.optional(Schema.Union(Schema.Int, Schema.String)),
});

type AudiobookshelfEpisode = typeof AudiobookshelfEpisode.Type;

const AudiobookshelfMetadata = Schema.Struct({
	title: Schema.String,
	asin: Schema.optional(Schema.NullOr(Schema.String)),
	isbn: Schema.optional(Schema.NullOr(Schema.String)),
	itunesId: Schema.optional(Schema.NullOr(Schema.String)),
});

const AudiobookshelfMedia = Schema.Struct({
	metadata: AudiobookshelfMetadata,
	ebookFormat: Schema.optional(Schema.NullOr(Schema.String)),
	episodes: Schema.optional(Schema.Array(AudiobookshelfEpisode)),
});

const AudiobookshelfItem = Schema.Struct({
	id: Schema.String,
	name: Schema.optional(Schema.String),
	userMediaProgress: AudiobookshelfProgress,
	media: Schema.optional(AudiobookshelfMedia),
	mediaType: Schema.optional(Schema.Literal("book", "podcast")),
});

type AudiobookshelfItem = typeof AudiobookshelfItem.Type;

const AudiobookshelfLibrariesResponse = Schema.Struct({
	libraries: Schema.Array(AudiobookshelfLibrary),
});

const AudiobookshelfListResponse = Schema.Struct({
	results: Schema.Array(AudiobookshelfItem),
});

const decodeItem = Schema.decodeUnknown(AudiobookshelfItem);
const decodeList = Schema.decodeUnknown(AudiobookshelfListResponse);
const decodeLibraries = Schema.decodeUnknown(AudiobookshelfLibrariesResponse);

type AudiobookshelfAdapterInput = {
	apiKey: string;
	apiUrl: string;
	allowInsecureConnections?: boolean;
};

const createHeaders = (apiKey: string): Record<string, string> => ({
	Accept: "application/json",
	Authorization: `Bearer ${apiKey}`,
});

const getPodcastEpisodeNumber = (episode: AudiobookshelfEpisode): number | null => {
	if (episode.episodeNumber != null) {
		return episode.episodeNumber;
	}
	if (episode.number != null) {
		return episode.number;
	}
	if (episode.index != null) {
		return episode.index;
	}
	if (episode.sequence != null) {
		return episode.sequence;
	}
	if (typeof episode.episode === "number") {
		return episode.episode;
	}
	if (typeof episode.episode === "string") {
		const parsed = Number.parseInt(episode.episode.trim(), 10);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
};

export const adaptAudiobookshelfData = Effect.fn("audiobookshelfAdapter.adaptData")(function* (
	input: AudiobookshelfAdapterInput,
) {
	const importedAt = nowIso();
	const headers = createHeaders(input.apiKey);
	const host = new URL(input.apiUrl).host;
	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ImportMediaEntityGroup>();
	const baseUrl = input.apiUrl.endsWith("/api") ? input.apiUrl : `${input.apiUrl}/api`;

	const librariesRaw = yield* requestSourceJson({
		headers,
		baseUrl,
		path: "libraries",
		sourceName: "Audiobookshelf",
		allowInsecureConnections: input.allowInsecureConnections,
	});
	const librariesResponse = yield* decodeLibraries(librariesRaw);

	let nextItemIndex = 0;
	for (const library of librariesResponse.libraries) {
		const startItemIndex = nextItemIndex;
		const listResult = yield* requestSourceJson({
			headers,
			baseUrl,
			sourceName: "Audiobookshelf",
			path: `libraries/${library.id}/items`,
			allowInsecureConnections: input.allowInsecureConnections,
			query: {
				expanded: 1,
				...(library.mediaType === "book" ? { filter: `progress.${FINISHED_FILTER}` } : {}),
			},
		}).pipe(Effect.flatMap(decodeList), Effect.either);
		if (Either.isLeft(listResult)) {
			failures.push(
				createSourceFetchFailure({
					host,
					error: listResult.left,
					itemIndex: startItemIndex,
					sourceLabel: library.name,
					sourceIdentifier: library.id,
					message: "Failed to fetch Audiobookshelf library items",
				}),
			);
			continue;
		}

		const items = listResult.right.results;
		const libraryFailures = yield* Effect.forEach(
			items,
			(item, offset) =>
				adaptAudiobookshelfItem({
					host,
					item,
					headers,
					baseUrl,
					failures,
					groupMap,
					importedAt,
					libraryName: library.name,
					itemIndex: startItemIndex + offset,
					allowInsecureConnections: input.allowInsecureConnections,
				}),
			{ concurrency: AUDIOBOOKSHELF_CONCURRENCY },
		);

		failures.push(...libraryFailures.filter(isNotNullAdapterFailure));
		nextItemIndex += items.length;
	}

	return {
		failures,
		entityGroups: finalizeEntityGroups(groupMap),
	} satisfies MediaImportAdapterResult;
});

const adaptAudiobookshelfItem = Effect.fn(function* (input: {
	host: string;
	baseUrl: string;
	itemIndex: number;
	importedAt: string;
	libraryName?: string;
	item: AudiobookshelfItem;
	headers: Record<string, string>;
	allowInsecureConnections?: boolean;
	failures: MediaImportAdapterFailure[];
	groupMap: Map<string, ImportMediaEntityGroup>;
}) {
	const { item, itemIndex, importedAt, host } = input;
	const metadata = item.media?.metadata;
	if (!metadata) {
		return {
			itemIndex,
			sourceLabel: item.name,
			sourceIdentifier: item.id,
			stage: "input_transformation",
			message: "Audiobookshelf item is missing media metadata",
		} satisfies MediaImportAdapterFailure;
	}

	const sourceLabel = metadata.title;
	const libraryName = input.libraryName?.trim();

	if (item.media.ebookFormat === "epub") {
		const isbn = metadata.isbn ? normalizeIsbn(metadata.isbn) : "";
		if (!isbn || !isValidIsbn(isbn)) {
			return {
				itemIndex,
				sourceLabel,
				sourceIdentifier: item.id,
				stage: "input_transformation",
				message: "Audiobookshelf ebook is missing a valid ISBN",
			} satisfies MediaImportAdapterFailure;
		}
		const group = getOrCreateMediaEntityGroup(
			input.groupMap,
			{
				sourceLabel,
				kind: "unresolved",
				identifierValue: isbn,
				identifierType: "isbn",
				entitySchemaSlug: "book",
			},
			itemIndex,
		);
		group.events.push(createCompleteEvent({ occurredAt: importedAt, completedOn: importedAt }));
		if (libraryName) {
			addCollectionMembership(group, libraryName);
		}
		return null;
	}

	const asin = metadata.asin?.trim();
	if (asin) {
		const group = getOrCreateMediaEntityGroup(
			input.groupMap,
			{
				sourceLabel,
				kind: "resolved",
				externalId: asin,
				entitySchemaSlug: "audiobook",
				scriptSlug: "audiobook.audible",
			},
			itemIndex,
		);
		group.events.push(createCompleteEvent({ occurredAt: importedAt, completedOn: importedAt }));
		if (libraryName) {
			addCollectionMembership(group, libraryName);
		}
		return null;
	}

	const itunesId = metadata.itunesId?.trim();
	if (!itunesId) {
		return {
			itemIndex,
			sourceLabel,
			sourceIdentifier: item.id,
			stage: "input_transformation",
			message: "Audiobookshelf item has no Audible, ISBN, or iTunes identifier",
		} satisfies MediaImportAdapterFailure;
	}

	const itemDetails = yield* requestSourceJson({
		headers: input.headers,
		baseUrl: input.baseUrl,
		path: `items/${item.id}`,
		sourceName: "Audiobookshelf",
		query: { expanded: 1, include: "progress" },
		allowInsecureConnections: input.allowInsecureConnections,
	}).pipe(Effect.flatMap(decodeItem), Effect.either);
	if (Either.isLeft(itemDetails)) {
		return createSourceFetchFailure({
			host,
			itemIndex,
			sourceLabel,
			error: itemDetails.left,
			sourceIdentifier: item.id,
			message: "Failed to fetch Audiobookshelf podcast details",
		});
	}

	const episodes = itemDetails.right.media?.episodes ?? [];
	if (episodes.length === 0) {
		return {
			itemIndex,
			sourceLabel,
			sourceIdentifier: item.id,
			stage: "input_transformation",
			message: "Audiobookshelf podcast has no episodes",
		} satisfies MediaImportAdapterFailure;
	}

	const podcastEvents: Array<{
		occurredAt: string;
		eventSchemaSlug: string;
		properties: Record<string, unknown>;
		episodeLocator: { type: "podcast"; episodeNumber: number };
	}> = [];
	let importedEpisodeCount = 0;
	for (const episode of episodes) {
		if (!episode.id) {
			continue;
		}
		const episodeDetails = yield* requestSourceJson({
			headers: input.headers,
			baseUrl: input.baseUrl,
			path: `items/${item.id}`,
			sourceName: "Audiobookshelf",
			allowInsecureConnections: input.allowInsecureConnections,
			query: { expanded: 1, include: "progress", episode: episode.id },
		}).pipe(Effect.flatMap(decodeItem), Effect.either);
		if (Either.isLeft(episodeDetails)) {
			input.failures.push(
				createSourceFetchFailure({
					host,
					itemIndex,
					sourceLabel,
					sourceIdentifier: item.id,
					error: episodeDetails.left,
					message: "Failed to fetch Audiobookshelf podcast episode progress",
				}),
			);
			continue;
		}
		if (!episodeDetails.right.userMediaProgress?.isFinished) {
			continue;
		}
		const podcastEpisode = getPodcastEpisodeNumber(episode);
		if (podcastEpisode == null) {
			continue;
		}
		podcastEvents.push({
			occurredAt: importedAt,
			eventSchemaSlug: "progress",
			properties: { progressPercent: 100 },
			episodeLocator: { type: "podcast", episodeNumber: podcastEpisode },
		});
		importedEpisodeCount += 1;
	}

	if (importedEpisodeCount === 0) {
		return {
			itemIndex,
			sourceLabel,
			sourceIdentifier: item.id,
			stage: "input_transformation",
			message: "Audiobookshelf podcast has no finished episodes with importable episode numbers",
		} satisfies MediaImportAdapterFailure;
	}

	const group = getOrCreateMediaEntityGroup(
		input.groupMap,
		{
			sourceLabel,
			kind: "resolved",
			externalId: itunesId,
			entitySchemaSlug: "podcast",
			scriptSlug: "podcast.itunes",
		},
		itemIndex,
	);
	group.events.push(...podcastEvents);
	if (libraryName) {
		addCollectionMembership(group, libraryName);
	}
	return null;
});

export const syncAudiobookshelfOwnedItems = Effect.fn("audiobookshelfAdapter.syncOwnedItems")(
	function* (input: AudiobookshelfAdapterInput) {
		const headers = createHeaders(input.apiKey);
		const baseUrl = input.apiUrl.endsWith("/api") ? input.apiUrl : `${input.apiUrl}/api`;
		const ownedItems: Array<{ entityRef: ImportEntityRef; provider: string }> = [];

		const librariesResponse = yield* requestSourceJson({
			headers,
			baseUrl,
			path: "libraries",
			sourceName: "Audiobookshelf",
			allowInsecureConnections: input.allowInsecureConnections,
		}).pipe(Effect.flatMap(decodeLibraries));

		for (const library of librariesResponse.libraries) {
			const listResult = yield* requestSourceJson({
				headers,
				baseUrl,
				query: { expanded: 1 },
				sourceName: "Audiobookshelf",
				path: `libraries/${library.id}/items`,
				allowInsecureConnections: input.allowInsecureConnections,
			}).pipe(Effect.flatMap(decodeList), Effect.either);
			if (Either.isLeft(listResult)) {
				continue;
			}

			for (const item of listResult.right.results) {
				const metadata = item.media?.metadata;
				if (!metadata) {
					continue;
				}
				const sourceLabel = metadata.title;

				if (item.media.ebookFormat === "epub") {
					const isbn = metadata.isbn ? normalizeIsbn(metadata.isbn) : "";
					if (!isbn || !isValidIsbn(isbn)) {
						continue;
					}
					ownedItems.push({
						provider: "audiobookshelf",
						entityRef: {
							sourceLabel,
							kind: "unresolved",
							identifierValue: isbn,
							identifierType: "isbn",
							entitySchemaSlug: "book",
						},
					});
					continue;
				}

				const asin = metadata.asin?.trim();
				if (asin) {
					ownedItems.push({
						provider: "audiobookshelf",
						entityRef: {
							sourceLabel,
							kind: "resolved",
							externalId: asin,
							entitySchemaSlug: "audiobook",
							scriptSlug: "audiobook.audible",
						},
					});
					continue;
				}

				const itunesId = metadata.itunesId?.trim();
				if (itunesId) {
					ownedItems.push({
						provider: "audiobookshelf",
						entityRef: {
							sourceLabel,
							kind: "resolved",
							externalId: itunesId,
							entitySchemaSlug: "podcast",
							scriptSlug: "podcast.itunes",
						},
					});
				}
			}
		}

		return ownedItems;
	},
);
