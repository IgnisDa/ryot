import { Either, ParseResult, Schema } from "effect";

import {
	addCollectionMembership,
	createBacklogEvent,
	createCompleteEvent,
	createDroppedEvent,
	createProgressEvent,
	createReviewEvent,
	finalizeEntityGroups,
	normalizeRating,
} from "../../media/book/shared";
import { getOccurredAtValue, nowIso, parseDateInput } from "../../media/dates";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/import-processor";
import type { ImportMediaEntityGroup } from "../../media/types";

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

const normalizeOccurredAt = (value: string | null | undefined, fallback: string): string =>
	parseDateInput(value) ?? fallback;

const getLatestOccurredAt = (left: string, right: string): string =>
	getOccurredAtValue(left) >= getOccurredAtValue(right) ? left : right;

const findEpisodeWatchDate = (
	activities: ReadonlyArray<WatcharrActivity>,
	season: number,
	episode: number,
	fallback: string,
): string => {
	let matchedOccurredAt: string | undefined;
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
			matchedOccurredAt = matchedOccurredAt
				? getLatestOccurredAt(matchedOccurredAt, occurredAt)
				: occurredAt;
		}
	}
	return matchedOccurredAt ?? fallback;
};

const getEntityTarget = (contentType: string) => {
	if (contentType === "movie") {
		return { entitySchemaSlug: "movie" as const, scriptSlug: "movie.tmdb" as const };
	}
	if (contentType === "tv") {
		return { entitySchemaSlug: "show" as const, scriptSlug: "show.tmdb" as const };
	}
	return undefined;
};

export const adaptWatcharrExport = (jsonText: string): MediaImportAdapterResult => {
	const parsed = JSON.parse(jsonText) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error("Watcharr export must be a JSON array");
	}

	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ImportMediaEntityGroup>();

	for (let itemIndex = 0; itemIndex < parsed.length; itemIndex++) {
		const rawItem = parsed[itemIndex];
		const parsedItem = decodeWatcharrItem(rawItem);
		if (Either.isLeft(parsedItem)) {
			failures.push({
				itemIndex,
				message: "Watcharr item is malformed",
				context: {
					issues: ParseResult.ArrayFormatter.formatErrorSync(parsedItem.left).map((issue) =>
						issue.path.join("."),
					),
				},
			});
			continue;
		}

		const item = parsedItem.right;
		const target = getEntityTarget(item.content.type);
		if (!target) {
			failures.push({
				itemIndex,
				sourceLabel: item.content.title,
				sourceIdentifier: String(item.content.tmdbId),
				message: `Unknown content type: ${item.content.type}`,
			});
			continue;
		}

		const importedAt = nowIso();
		const activities = item.activity ?? [];
		const group = getOrCreateMediaEntityGroup(
			groupMap,
			{
				kind: "resolved",
				scriptSlug: target.scriptSlug,
				sourceLabel: item.content.title,
				entitySchemaSlug: target.entitySchemaSlug,
				externalId: String(item.content.tmdbId),
			},
			itemIndex,
		);

		let latestOccurredAt: string | undefined;
		let hasHistory = false;

		if (target.entitySchemaSlug === "movie") {
			for (const activity of activities) {
				if (
					activity.type !== "IMPORTED_ADDED_WATCHED" &&
					activity.type !== "IMPORTED_ADDED_WATCHED_JF"
				) {
					continue;
				}
				const occurredAt = normalizeOccurredAt(activity.customDate, importedAt);
				latestOccurredAt = latestOccurredAt
					? getLatestOccurredAt(latestOccurredAt, occurredAt)
					: occurredAt;
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
				latestOccurredAt = latestOccurredAt
					? getLatestOccurredAt(latestOccurredAt, occurredAt)
					: occurredAt;
				hasHistory = true;
				group.events.push({
					occurredAt,
					eventSchemaSlug: "progress",
					properties: { progressPercent: 100 },
					episodeLocator: {
						type: "show",
						seasonNumber: episode.seasonNumber,
						episodeNumber: episode.episodeNumber,
					},
				});
			}
		}

		const fallbackOccurredAt = latestOccurredAt ?? importedAt;

		if (item.status === "PLANNED") {
			group.events.push(createBacklogEvent(fallbackOccurredAt));
		} else if (item.status === "WATCHING" && !hasHistory) {
			group.events.push(createProgressEvent(fallbackOccurredAt));
		} else if (item.status === "DROPPED") {
			group.events.push(createDroppedEvent({ occurredAt: fallbackOccurredAt }));
		} else if (item.status === "FINISHED" && target.entitySchemaSlug === "movie" && !hasHistory) {
			group.events.push(createCompleteEvent({ occurredAt: fallbackOccurredAt }));
		}

		const reviewEvent = createReviewEvent({
			text: item.thoughts,
			occurredAt: fallbackOccurredAt,
			rating: normalizeRating(String(item.rating)),
		});
		if (reviewEvent) {
			group.events.push(reviewEvent);
		}

		if (item.pinned) {
			addCollectionMembership(group, "Pinned");
		}
	}

	return { entityGroups: finalizeEntityGroups(groupMap), failures };
};
