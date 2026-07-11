import { Either, Schema } from "@ryot/sandbox-sdk/effect";

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
> & {
	events: ImportMediaEvent[];
	collectionMemberships: Array<{ collectionName: string }>;
};

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
	rating: Schema.Number,
	status: Schema.String,
	pinned: Schema.Boolean,
	thoughts: Schema.String,
	activity: Schema.optional(Schema.NullOr(Schema.Array(WatcharrActivity))),
	watchedEpisodes: Schema.optional(Schema.NullOr(Schema.Array(WatcharrEpisode))),
	content: Schema.Struct({ type: Schema.String, title: Schema.String, tmdbId: Schema.Int }),
});

const decodeWatcharrItem = Schema.decodeUnknownEither(WatcharrItem);
const decodeWatcharrActivityData = Schema.decodeUnknownEither(WatcharrActivityData);

const normalizeOccurredAt = (value: string | null | undefined, fallback: string) =>
	parseDateInput(value) ?? fallback;

const latestOccurredAt = (left: string, right: string) =>
	getOccurredAtValue(left) >= getOccurredAtValue(right) ? left : right;

const findEpisodeWatchDate = (
	activities: ReadonlyArray<WatcharrActivity>,
	season: number,
	episode: number,
	fallback: string,
) => {
	let matched: string | undefined;
	for (const activity of activities) {
		const activityData = activity.data;
		if (!activity.type.includes("EPISODE") || !activityData) {
			continue;
		}
		const parsed = Either.try(() => JSON.parse(activityData) as unknown);
		if (Either.isLeft(parsed)) {
			continue;
		}
		const decoded = decodeWatcharrActivityData(parsed.right);
		if (
			Either.isRight(decoded) &&
			decoded.right.season === season &&
			decoded.right.episode === episode
		) {
			const occurredAt = normalizeOccurredAt(activity.customDate, fallback);
			matched = matched ? latestOccurredAt(matched, occurredAt) : occurredAt;
		}
	}
	return matched ?? fallback;
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

export const adaptWatcharrExportBatch = (jsonText: string, start: number, limit: number) => {
	const parsed = JSON.parse(jsonText) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error("Watcharr export must be a JSON array");
	}

	const failures: MediaImportAdapterFailure[] = [];
	const groups = new Map<string, ImportMediaEntityGroupBuilder>();
	const end = Math.min(parsed.length, start + limit);
	for (let itemIndex = start; itemIndex < end; itemIndex += 1) {
		const parsedItem = decodeWatcharrItem(parsed[itemIndex]);
		if (Either.isLeft(parsedItem)) {
			failures.push({
				itemIndex,
				message: "Watcharr item is malformed",
			});
			continue;
		}

		const item = parsedItem.right;
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
				kind: "resolved" as const,
				externalId,
				sourceLabel: item.content.title,
				entitySchemaSlug,
				providerSlug: `${entitySchemaSlug}.tmdb`,
			},
		};
		groups.set(key, group);
		const importedAt = nowIso();
		const activities = item.activity ?? [];
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
				group.events.push(createCompleteEvent({ occurredAt, completedOn: occurredAt }));
			}
		} else {
			for (const episode of item.watchedEpisodes ?? []) {
				const occurredAt = findEpisodeWatchDate(
					activities,
					episode.seasonNumber,
					episode.episodeNumber,
					normalizeOccurredAt(episode.createdAt, importedAt),
				);
				latest = latest ? latestOccurredAt(latest, occurredAt) : occurredAt;
				hasHistory = true;
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
		}

		const occurredAt = latest ?? importedAt;
		if (item.status === "PLANNED") {
			group.events.push(createBacklogEvent(occurredAt));
		} else if (item.status === "WATCHING" && !hasHistory) {
			group.events.push(createProgressEvent(occurredAt));
		} else if (item.status === "DROPPED") {
			group.events.push(createDroppedEvent({ occurredAt }));
		} else if (item.status === "FINISHED" && entitySchemaSlug === "movie" && !hasHistory) {
			group.events.push(createCompleteEvent({ occurredAt }));
		}
		const review = createReviewEvent({
			occurredAt,
			text: item.thoughts,
			rating: normalizeRating(String(item.rating)),
		});
		if (review) {
			group.events.push(review);
		}
		if (
			item.pinned &&
			!group.collectionMemberships.some(({ collectionName }) => collectionName === "Pinned")
		) {
			group.collectionMemberships.push({ collectionName: "Pinned" });
		}
	}

	return {
		totalItems: parsed.length,
		failures,
		entityGroups: finalizeEntityGroups(groups.values()),
	};
};
