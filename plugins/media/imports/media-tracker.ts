import { Effect, Result, Schema } from "@ryot/sandbox-sdk/effect";

import { getOccurredAtValue, nowIso, parseDateInput } from "./dates";
import { getOrCreateMediaEntityGroup, type ImportMediaEntityGroupBuilder } from "./groups";
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
} from "./helpers";
import type { ImportEntityRef, MediaImportAdapterFailure } from "./schemas";
import {
	requestSourceJson,
	sourceApiHost,
	withSourceRequestOptions,
	type HttpHost,
} from "./source-api";
import { sourceFetchFailure } from "./source-helpers";

const MediaType = Schema.Literals(["audiobook", "book", "movie", "tv", "video_game"]);
type MediaType = typeof MediaType.Type;
const Item = Schema.Struct({ id: Schema.Int, mediaType: Schema.optional(MediaType) });
const List = Schema.Struct({
	id: Schema.Int,
	name: Schema.String,
	description: Schema.optional(Schema.NullOr(Schema.String)),
});
const Episode = Schema.Struct({
	id: Schema.Int,
	seasonNumber: Schema.Int,
	episodeNumber: Schema.Int,
});
const Season = Schema.Struct({
	episodes: Schema.Array(Episode).pipe(
		Schema.withDecodingDefault(Effect.succeed<ReadonlyArray<typeof Episode.Type>>([])),
		Schema.withConstructorDefault(Effect.sync(() => [])),
	),
});
const SeenHistory = Schema.Struct({
	id: Schema.Int,
	episodeId: Schema.optional(Schema.NullOr(Schema.Int)),
	date: Schema.optional(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
});
const Details = Schema.Struct({
	id: Schema.Int,
	name: Schema.optional(Schema.String),
	title: Schema.optional(Schema.String),
	igdbId: Schema.optional(Schema.NullOr(Schema.Int)),
	tmdbId: Schema.optional(Schema.NullOr(Schema.Int)),
	asin: Schema.optional(Schema.NullOr(Schema.String)),
	goodreadsId: Schema.optional(Schema.NullOr(Schema.Int)),
	audibleId: Schema.optional(Schema.NullOr(Schema.String)),
	openlibraryId: Schema.optional(Schema.NullOr(Schema.String)),
	userRating: Schema.optional(
		Schema.NullOr(
			Schema.Struct({
				id: Schema.Int,
				rating: Schema.optional(Schema.NullOr(Schema.Number)),
				review: Schema.optional(Schema.NullOr(Schema.String)),
				date: Schema.optional(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
			}),
		),
	),
	seasons: Schema.Array(Season).pipe(
		Schema.withDecodingDefault(Effect.succeed<ReadonlyArray<typeof Season.Type>>([])),
		Schema.withConstructorDefault(Effect.sync(() => [])),
	),
	seenHistory: Schema.Array(SeenHistory).pipe(
		Schema.withDecodingDefault(Effect.succeed<ReadonlyArray<typeof SeenHistory.Type>>([])),
		Schema.withConstructorDefault(Effect.sync(() => [])),
	),
});
type Details = typeof Details.Type;

const openLibraryKey = (value: string) => {
	const segments = value.trim().split("/");
	for (let index = segments.length - 1; index >= 0; index -= 1) {
		const segment = segments[index]?.trim();
		if (segment) {
			return segment;
		}
	}
	return undefined;
};
const label = (id: number, type: MediaType, details: Details) =>
	details.title ?? details.name ?? `${toTitleCaseWords(type)} ${id}`;
const fallbackDate = (details: Details, importedAt: string) => {
	const values = [
		...details.seenHistory.map(({ date }) => parseDateInput(date)),
		parseDateInput(details.userRating?.date),
	].filter((value): value is string => Boolean(value));
	return values.sort((a, b) => getOccurredAtValue(b) - getOccurredAtValue(a))[0] ?? importedAt;
};
const entityRef = (
	details: Details,
	type: MediaType,
	sourceLabel: string,
): ImportEntityRef | "goodreads" | null => {
	if (type === "movie" || type === "tv") {
		return details.tmdbId
			? {
					kind: "resolved",
					sourceLabel,
					externalId: String(details.tmdbId),
					entitySchemaSlug: type === "movie" ? "movie" : "show",
					providerSlug: type === "movie" ? "movie.tmdb" : "show.tmdb",
				}
			: null;
	}
	if (type === "video_game") {
		return details.igdbId
			? {
					kind: "resolved",
					sourceLabel,
					externalId: String(details.igdbId),
					providerSlug: "video-game.igdb",
					entitySchemaSlug: "video-game",
				}
			: null;
	}
	if (type === "audiobook") {
		const id = details.audibleId?.trim();
		return id
			? {
					kind: "resolved",
					externalId: id,
					sourceLabel,
					entitySchemaSlug: "audiobook",
					providerSlug: "audiobook.audible",
				}
			: null;
	}
	if (details.goodreadsId) {
		return "goodreads";
	}
	const id = details.openlibraryId ? openLibraryKey(details.openlibraryId) : undefined;
	return id
		? {
				kind: "resolved",
				externalId: id,
				sourceLabel,
				entitySchemaSlug: "book",
				providerSlug: "book.openlibrary",
			}
		: null;
};
const lifecycleEvent = (lifecycle: string, occurredAt: string) => {
	if (lifecycle === "backlog") {
		return createBacklogEvent(occurredAt);
	}
	if (lifecycle === "progress") {
		return createProgressEvent(occurredAt);
	}
	if (lifecycle === "dropped") {
		return createDroppedEvent({ occurredAt });
	}
	if (lifecycle === "on_hold") {
		return createOnHoldEvent({ occurredAt });
	}
	if (lifecycle === "complete") {
		return createCompleteEvent({ occurredAt, completedOn: occurredAt });
	}
	return null;
};

export const adaptMediaTrackerData = (
	input: { apiKey: string; apiUrl: string; allowInsecureConnections?: boolean | undefined },
	host: HttpHost,
) =>
	Effect.gen(function* () {
		const requestHost = withSourceRequestOptions(host, input.allowInsecureConnections);
		const importedAt = nowIso();
		const headers = { Accept: "application/json", "access-token": input.apiKey };
		const baseUrl = input.apiUrl.replace(/\/+$/, "").endsWith("/api")
			? input.apiUrl
			: `${input.apiUrl.replace(/\/+$/, "")}/api`;
		const fetch = (path: string, query?: Record<string, string | number>) =>
			requestSourceJson(requestHost, {
				path,
				headers,
				baseUrl,
				...(query === undefined ? {} : { query }),
			});
		const user = yield* fetch("user").pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ id: Schema.Int }))),
		);
		const lists = yield* fetch("lists", { userId: user.id }).pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(List))),
		);
		const failures: MediaImportAdapterFailure[] = [];
		const groups = new Map<string, ImportMediaEntityGroupBuilder>();
		const cache = new Map<number, Details>();
		const getDetails = (id: number) =>
			Effect.gen(function* () {
				const cached = cache.get(id);
				if (cached) {
					return cached;
				}
				const value = yield* fetch(`details/${id}`).pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(Details)),
				);
				cache.set(id, value);
				return value;
			});
		let itemIndex = 0;
		const normalize = (item: typeof Item.Type, details: Details, currentIndex: number) => {
			if (!item.mediaType) {
				failures.push({
					itemIndex: currentIndex,
					stage: "input_transformation",
					sourceIdentifier: String(item.id),
					message: "MediaTracker item has no media type",
				});
				return null;
			}
			const sourceLabel = label(item.id, item.mediaType, details);
			const ref = entityRef(details, item.mediaType, sourceLabel);
			if (ref === "goodreads") {
				failures.push({
					itemIndex: currentIndex,
					sourceLabel,
					stage: "input_transformation",
					sourceIdentifier: String(item.id),
					message: "MediaTracker book uses an unsupported Goodreads identifier",
				});
				return null;
			}
			if (!ref) {
				failures.push({
					itemIndex: currentIndex,
					sourceLabel,
					stage: "input_transformation",
					sourceIdentifier: String(item.id),
					message: `MediaTracker ${item.mediaType} item is missing a supported provider identifier`,
				});
				return null;
			}
			return { ref, sourceLabel, mediaType: item.mediaType };
		};
		for (const list of lists) {
			const listItems = yield* fetch("list/items", { listId: list.id }).pipe(
				Effect.flatMap(
					Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ mediaItem: Item }))),
				),
				Effect.result,
			);
			if (Result.isFailure(listItems)) {
				failures.push(
					sourceFetchFailure({
						itemIndex,
						sourceLabel: list.name,
						sourceIdentifier: String(list.id),
						host: sourceApiHost(input.apiUrl),
						message: "Failed to fetch MediaTracker list items",
					}),
				);
				continue;
			}
			for (const { mediaItem } of listItems.success) {
				const currentIndex = itemIndex++;
				const details = yield* getDetails(mediaItem.id).pipe(Effect.result);
				if (Result.isFailure(details)) {
					failures.push(
						sourceFetchFailure({
							itemIndex: currentIndex,
							sourceLabel: list.name,
							sourceIdentifier: String(mediaItem.id),
							host: sourceApiHost(input.apiUrl),
							message: "Failed to fetch MediaTracker item details",
						}),
					);
					continue;
				}
				const normalized = normalize(mediaItem, details.success, currentIndex);
				if (!normalized) {
					continue;
				}
				const group = getOrCreateMediaEntityGroup(groups, normalized.ref, currentIndex);
				const lifecycle = normalizeLifecycleStatus(list.name);
				if (lifecycle) {
					const event = lifecycleEvent(lifecycle, fallbackDate(details.success, importedAt));
					if (event) {
						group.events.push(event);
					}
				} else {
					addCollectionMembership(group, list.name);
				}
			}
		}
		const seenItems = yield* fetch("items").pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Item))),
		);
		for (const item of seenItems) {
			const currentIndex = itemIndex++;
			const details = yield* getDetails(item.id).pipe(Effect.result);
			if (Result.isFailure(details)) {
				failures.push(
					sourceFetchFailure({
						itemIndex: currentIndex,
						sourceIdentifier: String(item.id),
						host: sourceApiHost(input.apiUrl),
						message: "Failed to fetch MediaTracker item details",
					}),
				);
				continue;
			}
			const normalized = normalize(item, details.success, currentIndex);
			if (!normalized) {
				continue;
			}
			const group = getOrCreateMediaEntityGroup(groups, normalized.ref, currentIndex);
			if (normalized.mediaType === "tv") {
				for (const seen of details.success.seenHistory) {
					const occurredAt = parseDateInput(seen.date);
					if (!occurredAt || !seen.episodeId) {
						continue;
					}
					const episode = details.success.seasons
						.flatMap(({ episodes }) => episodes)
						.find(({ id }) => id === seen.episodeId);
					if (!episode) {
						failures.push({
							itemIndex: currentIndex,
							sourceLabel: normalized.sourceLabel,
							stage: "input_transformation",
							sourceIdentifier: String(item.id),
							message: "MediaTracker show history item is missing episode coverage",
						});
						continue;
					}
					group.events.push({
						occurredAt,
						eventSchemaSlug: "progress",
						properties: { progressPercent: 100 },
						unresolvedEpisode: {
							type: "show",
							seasonNumber: episode.seasonNumber,
							episodeNumber: episode.episodeNumber,
						},
					});
				}
			} else {
				for (const seen of details.success.seenHistory) {
					const occurredAt = parseDateInput(seen.date);
					if (occurredAt) {
						group.events.push(createCompleteEvent({ occurredAt, completedOn: occurredAt }));
					}
				}
			}
			const review = createReviewEvent({
				text: details.success.userRating?.review ?? null,
				rating:
					typeof details.success.userRating?.rating === "number"
						? Math.round(Math.min(details.success.userRating.rating * 20, 100) * 100) / 100
						: null,
				occurredAt:
					parseDateInput(details.success.userRating?.date) ??
					fallbackDate(details.success, importedAt),
			});
			if (review) {
				group.events.push(review);
			}
		}
		return { failures, totalItems: itemIndex, entityGroups: finalizeEntityGroups(groups.values()) };
	});
