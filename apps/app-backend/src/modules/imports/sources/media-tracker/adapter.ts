import { Effect, Either, Schema } from "effect";

import {
	addCollectionMembership,
	createBacklogEvent,
	createCompleteEvent,
	createDroppedEvent,
	createOnHoldEvent,
	createProgressEvent,
	createReviewEvent,
	finalizeEntityGroups,
	normalizeLifecycleStatus,
	toTitleCaseWords,
} from "../../media/book/shared";
import { getOccurredAtValue, nowIso, parseDateInput } from "../../media/dates";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/import-processor";
import type { ImportMediaEntityGroup } from "../../media/types";
import { requestSourceJson } from "../../runtime/source-api";
import { createSourceFetchFailure, isNotNullAdapterFailure } from "../shared/adapter-utils";

const MEDIA_TRACKER_CONCURRENCY = 5;

const MediaTrackerMediaType = Schema.Literal("audiobook", "book", "movie", "tv", "video_game");

const MediaTrackerItem = Schema.Struct({
	id: Schema.Int,
	mediaType: Schema.optional(MediaTrackerMediaType),
});

const MediaTrackerList = Schema.Struct({
	id: Schema.Int,
	name: Schema.String,
	description: Schema.optional(Schema.NullOr(Schema.String)),
});

const MediaTrackerListItem = Schema.Struct({ mediaItem: MediaTrackerItem });

const MediaTrackerEpisode = Schema.Struct({
	id: Schema.Int,
	seasonNumber: Schema.Int,
	episodeNumber: Schema.Int,
});

const MediaTrackerSeason = Schema.Struct({
	episodes: Schema.optionalWith(Schema.Array(MediaTrackerEpisode), { default: () => [] }),
});

const MediaTrackerSeen = Schema.Struct({
	id: Schema.Int,
	episodeId: Schema.optional(Schema.NullOr(Schema.Int)),
	date: Schema.optional(Schema.NullOr(Schema.Union(Schema.Number, Schema.String))),
});

const MediaTrackerReview = Schema.Struct({
	id: Schema.Int,
	rating: Schema.optional(Schema.NullOr(Schema.Number)),
	review: Schema.optional(Schema.NullOr(Schema.String)),
	date: Schema.optional(Schema.NullOr(Schema.Union(Schema.Number, Schema.String))),
});

const MediaTrackerDetails = Schema.Struct({
	id: Schema.Int,
	name: Schema.optional(Schema.String),
	title: Schema.optional(Schema.String),
	igdbId: Schema.optional(Schema.NullOr(Schema.Int)),
	tmdbId: Schema.optional(Schema.NullOr(Schema.Int)),
	asin: Schema.optional(Schema.NullOr(Schema.String)),
	goodreadsId: Schema.optional(Schema.NullOr(Schema.Int)),
	audibleId: Schema.optional(Schema.NullOr(Schema.String)),
	openlibraryId: Schema.optional(Schema.NullOr(Schema.String)),
	userRating: Schema.optional(Schema.NullOr(MediaTrackerReview)),
	seasons: Schema.optionalWith(Schema.Array(MediaTrackerSeason), { default: () => [] }),
	seenHistory: Schema.optionalWith(Schema.Array(MediaTrackerSeen), { default: () => [] }),
});

type MediaTrackerDetails = typeof MediaTrackerDetails.Type;
type MediaTrackerMediaType = typeof MediaTrackerMediaType.Type;

const decodeDetails = Schema.decodeUnknown(MediaTrackerDetails);
const decodeLists = Schema.decodeUnknown(Schema.Array(MediaTrackerList));
const decodeItems = Schema.decodeUnknown(Schema.Array(MediaTrackerItem));
const decodeUser = Schema.decodeUnknown(Schema.Struct({ id: Schema.Int }));
const decodeListItems = Schema.decodeUnknown(Schema.Array(MediaTrackerListItem));

type MediaTrackerAdapterInput = {
	apiKey: string;
	apiUrl: string;
	allowInsecureConnections?: boolean;
};

const createHeaders = (apiKey: string): Record<string, string> => ({
	"access-token": apiKey,
	Accept: "application/json",
});

const parseOpenlibraryKey = (value: string): string | undefined => {
	const normalized = value.trim();
	if (!normalized) {
		return undefined;
	}
	const segments = normalized.split("/");
	for (let index = segments.length - 1; index >= 0; index -= 1) {
		const segment = segments[index]?.trim();
		if (segment) {
			return segment;
		}
	}
	return undefined;
};

const getMediaTrackerLabel = (
	itemId: number,
	mediaType: MediaTrackerMediaType,
	details?: MediaTrackerDetails,
) => details?.title ?? details?.name ?? `${toTitleCaseWords(mediaType)} ${itemId}`;

const getFallbackOccurredAt = (details: MediaTrackerDetails, importedAt: string): string => {
	const timestamps = [
		...details.seenHistory.map((entry) => parseDateInput(entry.date)),
		parseDateInput(details.userRating?.date),
	].filter((value): value is string => Boolean(value));

	if (timestamps.length === 0) {
		return importedAt;
	}

	return (
		[...timestamps].sort(
			(left, right) => getOccurredAtValue(right) - getOccurredAtValue(left),
		)[0] ?? importedAt
	);
};

const getEntityRef = (input: {
	sourceLabel: string;
	details: MediaTrackerDetails;
	mediaType: MediaTrackerMediaType;
}) => {
	if (input.mediaType === "movie") {
		return input.details.tmdbId
			? {
					scriptSlug: "movie.tmdb",
					entitySchemaSlug: "movie",
					kind: "resolved" as const,
					sourceLabel: input.sourceLabel,
					externalId: String(input.details.tmdbId),
				}
			: undefined;
	}

	if (input.mediaType === "tv") {
		return input.details.tmdbId
			? {
					scriptSlug: "show.tmdb",
					entitySchemaSlug: "show",
					kind: "resolved" as const,
					sourceLabel: input.sourceLabel,
					externalId: String(input.details.tmdbId),
				}
			: undefined;
	}

	if (input.mediaType === "video_game") {
		return input.details.igdbId
			? {
					kind: "resolved" as const,
					scriptSlug: "video-game.igdb",
					sourceLabel: input.sourceLabel,
					entitySchemaSlug: "video-game",
					externalId: String(input.details.igdbId),
				}
			: undefined;
	}

	if (input.mediaType === "audiobook") {
		const audibleId = input.details.audibleId?.trim();
		return audibleId
			? {
					externalId: audibleId,
					kind: "resolved" as const,
					entitySchemaSlug: "audiobook",
					sourceLabel: input.sourceLabel,
					scriptSlug: "audiobook.audible",
				}
			: undefined;
	}

	if (input.details.goodreadsId) {
		return "goodreads_unsupported" as const;
	}

	const openlibraryKey = input.details.openlibraryId
		? parseOpenlibraryKey(input.details.openlibraryId)
		: undefined;
	return openlibraryKey
		? {
				entitySchemaSlug: "book",
				kind: "resolved" as const,
				externalId: openlibraryKey,
				sourceLabel: input.sourceLabel,
				scriptSlug: "book.openlibrary",
			}
		: undefined;
};

const createLifecycleEvent = (input: { occurredAt: string; lifecycle: string }) => {
	if (input.lifecycle === "backlog") {
		return createBacklogEvent(input.occurredAt);
	}
	if (input.lifecycle === "progress") {
		return createProgressEvent(input.occurredAt);
	}
	if (input.lifecycle === "dropped") {
		return createDroppedEvent({ occurredAt: input.occurredAt });
	}
	if (input.lifecycle === "on_hold") {
		return createOnHoldEvent({ occurredAt: input.occurredAt });
	}
	if (input.lifecycle === "complete") {
		return createCompleteEvent({ occurredAt: input.occurredAt, completedOn: input.occurredAt });
	}
	return undefined;
};

export const adaptMediaTrackerData = Effect.fn("mediaTrackerAdapter.adaptData")(function* (
	input: MediaTrackerAdapterInput,
) {
	const importedAt = nowIso();
	const headers = createHeaders(input.apiKey);
	const host = new URL(input.apiUrl).host;
	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ImportMediaEntityGroup>();
	const baseUrl = input.apiUrl.endsWith("/api") ? input.apiUrl : `${input.apiUrl}/api`;

	const fetchJson = (path: string, query?: Record<string, string | number>) =>
		requestSourceJson({
			path,
			query,
			headers,
			baseUrl,
			sourceName: "MediaTracker",
			allowInsecureConnections: input.allowInsecureConnections,
		});

	const userResponse = yield* fetchJson("user").pipe(Effect.flatMap(decodeUser));
	const lists = yield* fetchJson("lists", { userId: userResponse.id }).pipe(
		Effect.flatMap(decodeLists),
	);

	const detailCache = new Map<number, MediaTrackerDetails>();
	const getItemDetails = (itemId: number) =>
		Effect.gen(function* () {
			const cached = detailCache.get(itemId);
			if (cached) {
				return cached;
			}
			const details = yield* fetchJson(`details/${itemId}`).pipe(Effect.flatMap(decodeDetails));
			detailCache.set(itemId, details);
			return details;
		});

	let nextItemIndex = 0;
	for (const list of lists) {
		const startItemIndex = nextItemIndex;
		const listItemsResult = yield* fetchJson("list/items", { listId: list.id }).pipe(
			Effect.flatMap(decodeListItems),
			Effect.either,
		);
		if (Either.isLeft(listItemsResult)) {
			failures.push(
				createSourceFetchFailure({
					host,
					sourceLabel: list.name,
					itemIndex: startItemIndex,
					error: listItemsResult.left,
					sourceIdentifier: String(list.id),
					message: "Failed to fetch MediaTracker list items",
				}),
			);
			continue;
		}

		const listItems = listItemsResult.right;
		const listFailures = yield* Effect.forEach(
			listItems,
			(listItem, offset) =>
				Effect.gen(function* () {
					const itemIndex = startItemIndex + offset;
					const mediaType = listItem.mediaItem.mediaType;
					if (!mediaType) {
						return {
							itemIndex,
							stage: "input_transformation",
							message: "MediaTracker list item has no media type",
							sourceIdentifier: String(listItem.mediaItem.id),
						} satisfies MediaImportAdapterFailure;
					}

					const details = yield* getItemDetails(listItem.mediaItem.id).pipe(Effect.either);
					if (Either.isLeft(details)) {
						return createSourceFetchFailure({
							host,
							itemIndex,
							error: details.left,
							sourceLabel: list.name,
							sourceIdentifier: String(listItem.mediaItem.id),
							message: "Failed to fetch MediaTracker item details",
						});
					}

					const sourceLabel = getMediaTrackerLabel(listItem.mediaItem.id, mediaType, details.right);
					const ref = getEntityRef({ details: details.right, mediaType, sourceLabel });
					if (ref === "goodreads_unsupported") {
						return {
							itemIndex,
							sourceLabel,
							stage: "input_transformation",
							sourceIdentifier: String(listItem.mediaItem.id),
							message: "MediaTracker book uses an unsupported Goodreads identifier",
						} satisfies MediaImportAdapterFailure;
					}
					if (!ref) {
						return {
							itemIndex,
							sourceLabel,
							stage: "input_transformation",
							sourceIdentifier: String(listItem.mediaItem.id),
							message: `MediaTracker ${mediaType} item is missing a supported provider identifier`,
						} satisfies MediaImportAdapterFailure;
					}

					const group = getOrCreateMediaEntityGroup(groupMap, ref, itemIndex);
					const lifecycle = normalizeLifecycleStatus(list.name);
					if (lifecycle) {
						const event = createLifecycleEvent({
							lifecycle,
							occurredAt: getFallbackOccurredAt(details.right, importedAt),
						});
						if (event) {
							group.events.push(event);
						}
						return null;
					}

					addCollectionMembership(group, list.name);
					return null;
				}),
			{ concurrency: MEDIA_TRACKER_CONCURRENCY },
		);

		failures.push(...listFailures.filter(isNotNullAdapterFailure));
		nextItemIndex += listItems.length;
	}

	const seenItems = yield* fetchJson("items").pipe(Effect.flatMap(decodeItems));
	const seenStartIndex = nextItemIndex;
	const seenFailures = yield* Effect.forEach(
		seenItems,
		(item, offset) =>
			Effect.gen(function* () {
				const itemIndex = seenStartIndex + offset;
				const mediaType = item.mediaType;
				if (!mediaType) {
					return {
						itemIndex,
						stage: "input_transformation",
						sourceIdentifier: String(item.id),
						message: "MediaTracker item has no media type",
					} satisfies MediaImportAdapterFailure;
				}

				const details = yield* getItemDetails(item.id).pipe(Effect.either);
				if (Either.isLeft(details)) {
					return createSourceFetchFailure({
						host,
						itemIndex,
						error: details.left,
						sourceIdentifier: String(item.id),
						message: "Failed to fetch MediaTracker item details",
					});
				}

				const sourceLabel = getMediaTrackerLabel(item.id, mediaType, details.right);
				const ref = getEntityRef({ details: details.right, mediaType, sourceLabel });
				if (ref === "goodreads_unsupported") {
					return {
						itemIndex,
						sourceLabel,
						stage: "input_transformation",
						sourceIdentifier: String(item.id),
						message: "MediaTracker book uses an unsupported Goodreads identifier",
					} satisfies MediaImportAdapterFailure;
				}
				if (!ref) {
					return {
						itemIndex,
						sourceLabel,
						stage: "input_transformation",
						sourceIdentifier: String(item.id),
						message: `MediaTracker ${mediaType} item is missing a supported provider identifier`,
					} satisfies MediaImportAdapterFailure;
				}

				const group = getOrCreateMediaEntityGroup(groupMap, ref, itemIndex);
				if (mediaType === "tv") {
					for (const seen of details.right.seenHistory) {
						const occurredAt = parseDateInput(seen.date);
						if (!occurredAt || !seen.episodeId) {
							continue;
						}
						const episode = details.right.seasons
							.flatMap((season) => season.episodes)
							.find((candidate) => candidate.id === seen.episodeId);
						if (!episode) {
							failures.push({
								itemIndex,
								sourceLabel,
								stage: "input_transformation",
								sourceIdentifier: String(item.id),
								message: "MediaTracker show history item is missing episode coverage",
							});
							continue;
						}
						group.events.push({
							occurredAt,
							eventSchemaSlug: "progress",
							properties: {
								progressPercent: 100,
								showSeason: episode.seasonNumber,
								showEpisode: episode.episodeNumber,
							},
						});
					}
				} else {
					for (const seen of details.right.seenHistory) {
						const occurredAt = parseDateInput(seen.date);
						if (!occurredAt) {
							continue;
						}
						group.events.push(createCompleteEvent({ occurredAt, completedOn: occurredAt }));
					}
				}

				const reviewEvent = createReviewEvent({
					text: details.right.userRating?.review,
					rating:
						typeof details.right.userRating?.rating === "number"
							? Math.round(Math.min(details.right.userRating.rating * 20, 100) * 100) / 100
							: null,
					occurredAt:
						parseDateInput(details.right.userRating?.date) ??
						getFallbackOccurredAt(details.right, importedAt),
				});
				if (reviewEvent) {
					group.events.push(reviewEvent);
				}

				return null;
			}),
		{ concurrency: MEDIA_TRACKER_CONCURRENCY },
	);

	failures.push(...seenFailures.filter(isNotNullAdapterFailure));

	return {
		failures,
		entityGroups: finalizeEntityGroups(groupMap),
	} satisfies MediaImportAdapterResult;
});
