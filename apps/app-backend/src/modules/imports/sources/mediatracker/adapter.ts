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
	createImportSourceFailure,
	mapWithConcurrency,
	requestSourceJson,
	type SourceJsonRequestInput,
} from "../../runtime/source-api";

const MEDIATRACKER_CONCURRENCY = 5;

const mediatrackerMediaTypeSchema = z.enum(["audiobook", "book", "movie", "tv", "video_game"]);

const mediatrackerItemSchema = z.object({
	id: z.number().int(),
	mediaType: mediatrackerMediaTypeSchema.optional(),
});

const mediatrackerListSchema = z.object({
	id: z.number().int(),
	name: z.string(),
	description: z.string().optional().nullable(),
});

const mediatrackerListItemSchema = z.object({ mediaItem: mediatrackerItemSchema });

const mediatrackerEpisodeSchema = z.object({
	id: z.number().int(),
	seasonNumber: z.number().int(),
	episodeNumber: z.number().int(),
});

const mediatrackerSeasonSchema = z.object({
	episodes: z.array(mediatrackerEpisodeSchema).default([]),
});

const mediatrackerSeenSchema = z.object({
	id: z.number().int(),
	date: z.number().or(z.string()).optional().nullable(),
	episodeId: z.number().int().optional().nullable(),
});

const mediatrackerReviewSchema = z.object({
	id: z.number().int(),
	date: z.number().or(z.string()).optional().nullable(),
	rating: z.number().optional().nullable(),
	review: z.string().optional().nullable(),
});

const mediatrackerDetailsSchema = z.object({
	id: z.number().int(),
	name: z.string().optional(),
	title: z.string().optional(),
	asin: z.string().optional().nullable(),
	igdbId: z.number().int().optional().nullable(),
	tmdbId: z.number().int().optional().nullable(),
	seasons: z.array(mediatrackerSeasonSchema).default([]),
	goodreadsId: z.number().int().optional().nullable(),
	openlibraryId: z.string().optional().nullable(),
	userRating: mediatrackerReviewSchema.optional().nullable(),
	seenHistory: z.array(mediatrackerSeenSchema).default([]),
	audibleId: z.string().optional().nullable(),
});

type MediatrackerAdapterInput = {
	apiKey: string;
	apiUrl: string;
	allowInsecureConnections?: boolean;
};

type MediatrackerImportAdapterDeps = {
	requestJson: <T>(input: SourceJsonRequestInput) => Promise<T>;
	mapWithConcurrency: typeof mapWithConcurrency;
};

const mediatrackerImportAdapterDeps: MediatrackerImportAdapterDeps = {
	requestJson: requestSourceJson,
	mapWithConcurrency,
};

type MediatrackerDetails = z.infer<typeof mediatrackerDetailsSchema>;
type MediatrackerMediaType = z.infer<typeof mediatrackerMediaTypeSchema>;

const createHeaders = (apiKey: string): Record<string, string> => ({
	Accept: "application/json",
	"access-token": apiKey,
});

const parseOccurredAt = (value: number | string | null | undefined): string | null => {
	if (typeof value === "number") {
		const parsed = dayjs(value);
		return parsed.isValid() ? parsed.toISOString() : null;
	}
	if (typeof value === "string") {
		const parsed = dayjs(value);
		return parsed.isValid() ? parsed.toISOString() : null;
	}
	return null;
};

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
	mediaType: MediatrackerMediaType,
	details?: MediatrackerDetails,
) => details?.title ?? details?.name ?? `${toTitleCaseWords(mediaType)} ${itemId}`;

const getFallbackOccurredAt = (details: MediatrackerDetails, importedAt: string): string => {
	const timestamps = [
		...details.seenHistory.map((entry) => parseOccurredAt(entry.date)),
		parseOccurredAt(details.userRating?.date),
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
	details: MediatrackerDetails;
	mediaType: MediatrackerMediaType;
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

const createMediatrackerItemFailure = (input: {
	error: unknown;
	host: string;
	message: string;
	itemIndex: number;
	sourceLabel?: string;
	sourceIdentifier?: string;
}): MediaImportAdapterFailure =>
	createImportSourceFailure({
		error: input.error,
		host: input.host,
		message: input.message,
		itemIndex: input.itemIndex,
		stage: "source_fetch",
		sourceLabel: input.sourceLabel,
		sourceIdentifier: input.sourceIdentifier,
	});

const isAdapterFailure = (
	value: MediaImportAdapterFailure | null,
): value is MediaImportAdapterFailure => value !== null;

export const adaptMediatrackerData = async (
	input: MediatrackerAdapterInput,
	deps: MediatrackerImportAdapterDeps = mediatrackerImportAdapterDeps,
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

	const lists = z.array(mediatrackerListSchema).parse(
		await deps.requestJson({
			headers,
			baseUrl,
			path: "lists",
			query: { userId: userResponse.id },
			sourceName: "MediaTracker",
			allowInsecureConnections: input.allowInsecureConnections,
		}),
	);

	const detailCache = new Map<string, Promise<MediatrackerDetails>>();
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
				.then((response) => mediatrackerDetailsSchema.parse(response))
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
		let listItems: Array<z.infer<typeof mediatrackerListItemSchema>>;
		try {
			listItems = z.array(mediatrackerListItemSchema).parse(
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
				createMediatrackerItemFailure({
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
			MEDIATRACKER_CONCURRENCY,
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

				let details: MediatrackerDetails;
				try {
					details = await getItemDetails(listItem.mediaItem.id);
				} catch (error) {
					return createMediatrackerItemFailure({
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

		failures.push(...listFailures.filter(isAdapterFailure));
		nextItemIndex += listItems.length;
	}
	// oxlint-enable no-await-in-loop

	const seenItems = z.array(mediatrackerItemSchema).parse(
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
		MEDIATRACKER_CONCURRENCY,
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

			let details: MediatrackerDetails;
			try {
				details = await getItemDetails(item.id);
			} catch (error) {
				return createMediatrackerItemFailure({
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
					const occurredAt = parseOccurredAt(seen.date);
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
					const occurredAt = parseOccurredAt(seen.date);
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
					parseOccurredAt(details.userRating?.date) ?? getFallbackOccurredAt(details, importedAt),
			});
			if (reviewEvent) {
				group.events.push(reviewEvent);
			}

			return null;
		},
	);

	failures.push(...seenFailures.filter(isAdapterFailure));

	return {
		failures,
		entityGroups: finalizeEntityGroups(groupMap),
	};
};
