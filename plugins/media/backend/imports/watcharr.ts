import { Result, Schema } from "@ryot-app/sandbox-sdk/effect";

import { getOccurredAtValue, nowIso, parseDateInput } from "./dates";
import {
	createBacklogEvent,
	createCompleteEvent,
	createDroppedEvent,
	createProgressEvent,
	createReviewEvent,
	finalizeEntityGroups,
	normalizeRating,
} from "./helpers";
import type {
	ImportMediaEntityGroup,
	ImportMediaEvent,
	MediaImportAdapterFailure,
} from "./schemas";

type ImportMediaEntityGroupBuilder = Omit<
	ImportMediaEntityGroup,
	"events" | "collectionMemberships"
> & { events: ImportMediaEvent[]; collectionMemberships: Array<{ collectionName: string }> };

const WatcharrActivity = Schema.Struct({
	type: Schema.String,
	data: Schema.optional(Schema.NullOr(Schema.String)),
	customDate: Schema.optional(Schema.NullOr(Schema.String)),
});

type WatcharrActivity = typeof WatcharrActivity.Type;

const WatcharrEpisode = Schema.Struct({
	status: Schema.String,
	createdAt: Schema.String,
	seasonNumber: Schema.Int,
	episodeNumber: Schema.Int,
});

const WatcharrActivityData = Schema.Struct({
	season: Schema.optional(Schema.Int),
	episode: Schema.optional(Schema.Int),
});

const WatcharrItem = Schema.Struct({
	rating: Schema.Finite,
	status: Schema.String,
	pinned: Schema.Boolean,
	thoughts: Schema.String,
	activity: Schema.optional(Schema.NullOr(Schema.Array(WatcharrActivity))),
	watchedEpisodes: Schema.optional(Schema.NullOr(Schema.Array(WatcharrEpisode))),
	content: Schema.Struct({ tmdbId: Schema.Int, type: Schema.String, title: Schema.String }),
});

const decodeWatcharrItem = Schema.decodeUnknownResult(WatcharrItem);
const decodeWatcharrActivityData = Schema.decodeUnknownResult(WatcharrActivityData);

const normalizeOccurredAt = (value: string | null | undefined, fallback: string) =>
	parseDateInput(value) ?? fallback;

const latestOccurredAt = (left: string, right: string) =>
	getOccurredAtValue(left) >= getOccurredAtValue(right) ? left : right;

const episodeWatchDates = (activities: ReadonlyArray<WatcharrActivity>) => {
	const dates = new Map<string, { occurredAt: string | null; usesFallback: boolean }>();
	for (const activity of activities) {
		const activityData = activity.data;
		if (!activity.type.includes("EPISODE") || !activityData) {
			continue;
		}
		const parsed = Result.try(() => JSON.parse(activityData) as unknown);
		if (Result.isFailure(parsed)) {
			continue;
		}
		const decoded = decodeWatcharrActivityData(parsed.success);
		if (
			Result.isSuccess(decoded) &&
			decoded.success.season !== undefined &&
			decoded.success.episode !== undefined
		) {
			const key = JSON.stringify([decoded.success.season, decoded.success.episode]);
			const prior = dates.get(key);
			const occurredAt = parseDateInput(activity.customDate);
			dates.set(key, {
				usesFallback: (prior?.usesFallback ?? false) || !occurredAt,
				occurredAt:
					occurredAt && prior?.occurredAt
						? latestOccurredAt(prior.occurredAt, occurredAt)
						: (occurredAt ?? prior?.occurredAt ?? null),
			});
		}
	}
	return dates;
};

const entitySchemaSlugForContentType = (contentType: string) => {
	if (contentType === "movie") {
		return "movie" as const;
	}
	if (contentType === "tv") {
		return "show" as const;
	}
	return null;
};

export const adaptWatcharrExportBatch = (
	jsonText: string,
	start: number,
	limit: number,
	importedAt = nowIso(),
	eventStart = 0,
	eventLimit = Number.MAX_SAFE_INTEGER,
) => {
	const parsed = JSON.parse(jsonText) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error("Watcharr export must be a JSON array");
	}

	const failures: MediaImportAdapterFailure[] = [];
	const groups = new Map<string, ImportMediaEntityGroupBuilder>();
	const end = Math.min(parsed.length, start + limit);
	let nextEventOffset = 0;
	for (let itemIndex = start; itemIndex < end; itemIndex += 1) {
		const parsedItem = decodeWatcharrItem(parsed[itemIndex]);
		if (Result.isFailure(parsedItem)) {
			failures.push({ itemIndex, message: "Watcharr item is malformed" });
			continue;
		}

		const item = parsedItem.success;
		const entitySchemaSlug = entitySchemaSlugForContentType(item.content.type);
		if (!entitySchemaSlug) {
			failures.push({
				itemIndex,
				sourceLabel: item.content.title,
				sourceIdentifier: String(item.content.tmdbId),
				message: `Unknown content type: ${item.content.type}`,
			});
			continue;
		}

		const externalId = String(item.content.tmdbId);
		const key = `${entitySchemaSlug}|${externalId}`;
		const group = groups.get(key) ?? {
			itemIndex,
			events: [],
			collectionMemberships: [],
			entityRef: {
				externalId,
				entitySchemaSlug,
				kind: "resolved" as const,
				sourceLabel: item.content.title,
				providerSlug: `${entitySchemaSlug}.tmdb`,
			},
		};
		groups.set(key, group);
		const activities = item.activity ?? [];
		const episodeDates = episodeWatchDates(activities);
		let eventCount = 0;
		const pushEvent = (event: ImportMediaEvent) => {
			if (eventCount >= eventStart && eventCount < eventStart + eventLimit) {
				group.events.push(event);
			}
			eventCount++;
		};
		let latest: string | undefined;
		let hasHistory = false;

		if (entitySchemaSlug === "movie") {
			for (const activity of activities) {
				if (!["IMPORTED_ADDED_WATCHED", "IMPORTED_ADDED_WATCHED_JF"].includes(activity.type)) {
					continue;
				}
				const occurredAt = normalizeOccurredAt(activity.customDate, importedAt);
				latest = latest ? latestOccurredAt(latest, occurredAt) : occurredAt;
				hasHistory = true;
				pushEvent(createCompleteEvent({ occurredAt, completedOn: occurredAt }));
			}
		} else {
			for (const episode of item.watchedEpisodes ?? []) {
				const fallback = normalizeOccurredAt(episode.createdAt, importedAt);
				const date = episodeDates.get(
					JSON.stringify([episode.seasonNumber, episode.episodeNumber]),
				);
				let occurredAt = fallback;
				if (date?.occurredAt) {
					occurredAt = date.usesFallback
						? latestOccurredAt(date.occurredAt, fallback)
						: date.occurredAt;
				}
				latest = latest ? latestOccurredAt(latest, occurredAt) : occurredAt;
				hasHistory = true;
				pushEvent({
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
		}

		const occurredAt = latest ?? importedAt;
		if (item.status === "PLANNED") {
			pushEvent(createBacklogEvent(occurredAt));
		} else if (item.status === "WATCHING" && !hasHistory) {
			pushEvent(createProgressEvent(occurredAt));
		} else if (item.status === "DROPPED") {
			pushEvent(createDroppedEvent({ occurredAt }));
		} else if (item.status === "FINISHED" && entitySchemaSlug === "movie" && !hasHistory) {
			pushEvent(createCompleteEvent({ occurredAt }));
		}
		const review = createReviewEvent({
			occurredAt,
			text: item.thoughts,
			rating: normalizeRating(String(item.rating)),
		});
		if (review) {
			pushEvent(review);
		}
		if (
			item.pinned &&
			!group.collectionMemberships.some(({ collectionName }) => collectionName === "Pinned")
		) {
			group.collectionMemberships.push({ collectionName: "Pinned" });
		}
		nextEventOffset = eventStart + eventLimit < eventCount ? eventStart + eventLimit : 0;
	}

	return {
		failures,
		nextEventOffset,
		totalItems: parsed.length,
		entityGroups: finalizeEntityGroups(groups.values()),
	};
};
