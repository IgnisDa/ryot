import { dayjs } from "@ryot/ts-utils/dayjs";
import { z } from "zod";

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
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/import-processor";
import {
	mapWithConcurrency,
	requestSourceJson,
	type SourceJsonRequestInput,
} from "../../runtime/source-api";
import {
	createSourceFetchFailure,
	isNotNullAdapterFailure,
	parseDateInput,
} from "../shared/adapter-utils";

const MEDIA_TRACKER_CONCURRENCY = 5;

const mediaTrackerMediaTypeSchema = z.enum(["audiobook", "book", "movie", "tv", "video_game"]);

const mediaTrackerItemSchema = z.object({
	id: z.number().int(),
	mediaType: mediaTrackerMediaTypeSchema.optional(),
});

const mediaTrackerListSchema = z.object({
	id: z.number().int(),
	name: z.string(),
	description: z.string().optional().nullable(),
});

const mediaTrackerListItemSchema = z.object({ mediaItem: mediaTrackerItemSchema });

const mediaTrackerEpisodeSchema = z.object({
	id: z.number().int(),
	seasonNumber: z.number().int(),
	episodeNumber: z.number().int(),
});

const mediaTrackerSeasonSchema = z.object({
	episodes: z.array(mediaTrackerEpisodeSchema).default([]),
});

const mediaTrackerSeenSchema = z.object({
	id: z.number().int(),
	date: z.number().or(z.string()).optional().nullable(),
	episodeId: z.number().int().optional().nullable(),
});

const mediaTrackerReviewSchema = z.object({
	id: z.number().int(),
	date: z.number().or(z.string()).optional().nullable(),
	rating: z.number().optional().nullable(),
	review: z.string().optional().nullable(),
});

const mediaTrackerDetailsSchema = z.object({
	id: z.number().int(),
	name: z.string().optional(),
	title: z.string().optional(),
	asin: z.string().optional().nullable(),
	igdbId: z.number().int().optional().nullable(),
	tmdbId: z.number().int().optional().nullable(),
	seasons: z.array(mediaTrackerSeasonSchema).default([]),
	goodreadsId: z.number().int().optional().nullable(),
	openlibraryId: z.string().optional().nullable(),
	userRating: mediaTrackerReviewSchema.optional().nullable(),
	seenHistory: z.array(mediaTrackerSeenSchema).default([]),
	audibleId: z.string().optional().nullable(),
});

type MediaTrackerAdapterInput = {
	apiKey: string;
	apiUrl: string;
	allowInsecureConnections?: boolean;
};

type MediaTrackerImportAdapterDeps = {
	requestJson: <T>(input: SourceJsonRequestInput) => Promise<T>;
	mapWithConcurrency: typeof mapWithConcurrency;
};

const mediaTrackerImportAdapterDeps: MediaTrackerImportAdapterDeps = {
	requestJson: requestSourceJson,
	mapWithConcurrency,
};

type MediaTrackerDetails = z.infer<typeof mediaTrackerDetailsSchema>;
type MediaTrackerMediaType = z.infer<typeof mediaTrackerMediaTypeSchema>;

const createHeaders = (apiKey: string): Record<string, string> => ({
	Accept: "application/json",
	"access-token": apiKey,
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
		[...timestamps].sort((left, right) => dayjs(right).valueOf() - dayjs(left).valueOf())[0] ??
		importedAt
	);
};

const getEntityRef = (input: {
	details: MediaTrackerDetails;
	mediaType: MediaTrackerMediaType;
	sourceLabel: string;
}) => {
	if (input.mediaType === "movie") {
		return input.details.tmdbId
			? {
					kind: "resolved" as const,
					externalId: String(input.details.tmdbId),
					sourceLabel: input.sourceLabel,
					entitySchemaSlug: "movie",
					scriptSlug: "movie.tmdb",
				}
			: undefined;
	}

	if (input.mediaType === "tv") {
		return input.details.tmdbId
			? {
					kind: "resolved" as const,
					externalId: String(input.details.tmdbId),
					sourceLabel: input.sourceLabel,
					entitySchemaSlug: "show",
					scriptSlug: "show.tmdb",
				}
			: undefined;
	}

	if (input.mediaType === "video_game") {
		return input.details.igdbId
			? {
					kind: "resolved" as const,
					externalId: String(input.details.igdbId),
					sourceLabel: input.sourceLabel,
					entitySchemaSlug: "video-game",
					scriptSlug: "video-game.igdb",
				}
			: undefined;
	}

	if (input.mediaType === "audiobook") {
		const audibleId = input.details.audibleId?.trim();
		return audibleId
			? {
					kind: "resolved" as const,
					externalId: audibleId,
					sourceLabel: input.sourceLabel,
					entitySchemaSlug: "audiobook",
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
				kind: "resolved" as const,
				externalId: openlibraryKey,
				sourceLabel: input.sourceLabel,
				entitySchemaSlug: "book",
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

export const adaptMediaTrackerData = async (
	input: MediaTrackerAdapterInput,
	deps: MediaTrackerImportAdapterDeps = mediaTrackerImportAdapterDeps,
): Promise<MediaImportAdapterResult> => {
	const failures: MediaImportAdapterFailure[] = [];
	const importedAt = dayjs().toISOString();
	const host = new URL(input.apiUrl).host;
	const headers = createHeaders(input.apiKey);
	const groupMap = new Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>();
	const baseUrl = input.apiUrl.endsWith("/api") ? input.apiUrl : `${input.apiUrl}/api`;

	const userResponse = z.object({ id: z.number().int() }).parse(
		await deps.requestJson({
			headers,
			baseUrl,
			path: "user",
			sourceName: "MediaTracker",
			allowInsecureConnections: input.allowInsecureConnections,
		}),
	);

	const lists = z.array(mediaTrackerListSchema).parse(
		await deps.requestJson({
			headers,
			baseUrl,
			path: "lists",
			query: { userId: userResponse.id },
			sourceName: "MediaTracker",
			allowInsecureConnections: input.allowInsecureConnections,
		}),
	);

	const detailCache = new Map<string, Promise<MediaTrackerDetails>>();
	const getItemDetails = async (itemId: number) => {
		const key = String(itemId);
		let current = detailCache.get(key);
		if (!current) {
			current = deps
				.requestJson({
					headers,
					baseUrl,
					path: `details/${itemId}`,
					sourceName: "MediaTracker",
					allowInsecureConnections: input.allowInsecureConnections,
				})
				.then((response) => mediaTrackerDetailsSchema.parse(response))
				.catch((error) => {
					detailCache.delete(key);
					throw error;
				});
			detailCache.set(key, current);
		}
		return current;
	};

	let nextItemIndex = 0;
	// oxlint-disable no-await-in-loop
	for (const list of lists) {
		let listItems: Array<z.infer<typeof mediaTrackerListItemSchema>>;
		try {
			listItems = z.array(mediaTrackerListItemSchema).parse(
				await deps.requestJson({
					headers,
					baseUrl,
					path: "list/items",
					query: { listId: list.id },
					sourceName: "MediaTracker",
					allowInsecureConnections: input.allowInsecureConnections,
				}),
			);
		} catch (error) {
			failures.push(
				createSourceFetchFailure({
					error,
					host,
					itemIndex: nextItemIndex,
					message: "Failed to fetch MediaTracker list items",
					sourceIdentifier: String(list.id),
					sourceLabel: list.name,
				}),
			);
			continue;
		}

		const listFailures = await deps.mapWithConcurrency(
			listItems,
			MEDIA_TRACKER_CONCURRENCY,
			async (listItem, offset) => {
				const itemIndex = nextItemIndex + offset;
				const mediaType = listItem.mediaItem.mediaType;
				if (!mediaType) {
					return {
						itemIndex,
						message: "MediaTracker list item has no media type",
						sourceIdentifier: String(listItem.mediaItem.id),
						stage: "input_transformation",
					} satisfies MediaImportAdapterFailure;
				}

				let details: MediaTrackerDetails;
				try {
					details = await getItemDetails(listItem.mediaItem.id);
				} catch (error) {
					return createSourceFetchFailure({
						error,
						host,
						itemIndex,
						message: "Failed to fetch MediaTracker item details",
						sourceIdentifier: String(listItem.mediaItem.id),
						sourceLabel: list.name,
					});
				}

				const sourceLabel = getMediaTrackerLabel(listItem.mediaItem.id, mediaType, details);
				const ref = getEntityRef({ details, mediaType, sourceLabel });
				if (ref === "goodreads_unsupported") {
					return {
						itemIndex,
						message: "MediaTracker book uses an unsupported Goodreads identifier",
						sourceLabel,
						sourceIdentifier: String(listItem.mediaItem.id),
						stage: "input_transformation",
					} satisfies MediaImportAdapterFailure;
				}
				if (!ref) {
					return {
						itemIndex,
						message: `MediaTracker ${mediaType} item is missing a supported provider identifier`,
						sourceLabel,
						sourceIdentifier: String(listItem.mediaItem.id),
						stage: "input_transformation",
					} satisfies MediaImportAdapterFailure;
				}

				const group = getOrCreateMediaEntityGroup(groupMap, ref, itemIndex);
				const lifecycle = normalizeLifecycleStatus(list.name);
				if (lifecycle) {
					const event = createLifecycleEvent({
						lifecycle,
						occurredAt: getFallbackOccurredAt(details, importedAt),
					});
					if (event) {
						group.events.push(event);
					}
					return null;
				}

				addCollectionMembership(group, list.name);
				return null;
			},
		);

		failures.push(...listFailures.filter(isNotNullAdapterFailure));
		nextItemIndex += listItems.length;
	}
	// oxlint-enable no-await-in-loop

	const seenItems = z.array(mediaTrackerItemSchema).parse(
		await deps.requestJson({
			headers,
			baseUrl,
			path: "items",
			sourceName: "MediaTracker",
			allowInsecureConnections: input.allowInsecureConnections,
		}),
	);

	const seenFailures = await deps.mapWithConcurrency(
		seenItems,
		MEDIA_TRACKER_CONCURRENCY,
		async (item, offset) => {
			const itemIndex = nextItemIndex + offset;
			const mediaType = item.mediaType;
			if (!mediaType) {
				return {
					itemIndex,
					message: "MediaTracker item has no media type",
					sourceIdentifier: String(item.id),
					stage: "input_transformation",
				} satisfies MediaImportAdapterFailure;
			}

			let details: MediaTrackerDetails;
			try {
				details = await getItemDetails(item.id);
			} catch (error) {
				return createSourceFetchFailure({
					error,
					host,
					itemIndex,
					message: "Failed to fetch MediaTracker item details",
					sourceIdentifier: String(item.id),
				});
			}

			const sourceLabel = getMediaTrackerLabel(item.id, mediaType, details);
			const ref = getEntityRef({ details, mediaType, sourceLabel });
			if (ref === "goodreads_unsupported") {
				return {
					itemIndex,
					message: "MediaTracker book uses an unsupported Goodreads identifier",
					sourceLabel,
					sourceIdentifier: String(item.id),
					stage: "input_transformation",
				} satisfies MediaImportAdapterFailure;
			}
			if (!ref) {
				return {
					itemIndex,
					message: `MediaTracker ${mediaType} item is missing a supported provider identifier`,
					sourceLabel,
					sourceIdentifier: String(item.id),
					stage: "input_transformation",
				} satisfies MediaImportAdapterFailure;
			}

			const group = getOrCreateMediaEntityGroup(groupMap, ref, itemIndex);
			if (mediaType === "tv") {
				for (const seen of details.seenHistory) {
					const occurredAt = parseDateInput(seen.date);
					if (!occurredAt || !seen.episodeId) {
						continue;
					}
					const episode = details.seasons
						.flatMap((season) => season.episodes)
						.find((candidate) => candidate.id === seen.episodeId);
					if (!episode) {
						failures.push({
							itemIndex,
							message: "MediaTracker show history item is missing episode coverage",
							sourceLabel,
							sourceIdentifier: String(item.id),
							stage: "input_transformation",
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
				for (const seen of details.seenHistory) {
					const occurredAt = parseDateInput(seen.date);
					if (!occurredAt) {
						continue;
					}
					group.events.push(createCompleteEvent({ occurredAt, completedOn: occurredAt }));
				}
			}

			const reviewEvent = createReviewEvent({
				text: details.userRating?.review,
				rating:
					typeof details.userRating?.rating === "number"
						? Math.round(Math.min(details.userRating.rating * 20, 100) * 100) / 100
						: null,
				occurredAt:
					parseDateInput(details.userRating?.date) ?? getFallbackOccurredAt(details, importedAt),
			});
			if (reviewEvent) {
				group.events.push(reviewEvent);
			}

			return null;
		},
	);

	failures.push(...seenFailures.filter(isNotNullAdapterFailure));

	return {
		failures,
		entityGroups: finalizeEntityGroups(groupMap),
	};
};
