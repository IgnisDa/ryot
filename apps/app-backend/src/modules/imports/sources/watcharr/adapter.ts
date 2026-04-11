import { dayjs } from "@ryot/ts-utils/dayjs";
import { z } from "zod";

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
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/import-processor";

const watcharrActivitySchema = z.object({
	type: z.string(),
	data: z.string().nullable().optional(),
	customDate: z.string().nullable().optional(),
});

const watcharrEpisodeSchema = z.object({
	status: z.string(),
	createdAt: z.string(),
	seasonNumber: z.number().int(),
	episodeNumber: z.number().int(),
});

const watcharrActivityDataSchema = z.object({
	season: z.number().int().optional(),
	episode: z.number().int().optional(),
});

const watcharrItemSchema = z.object({
	pinned: z.boolean(),
	status: z.string(),
	rating: z.number(),
	thoughts: z.string(),
	activity: z.array(watcharrActivitySchema).nullable().optional(),
	watchedEpisodes: z.array(watcharrEpisodeSchema).nullable().optional(),
	content: z.object({ type: z.string(), title: z.string(), tmdbId: z.number().int() }),
});

const normalizeOccurredAt = (value: string | null | undefined, fallback: string): string => {
	if (!value) {
		return fallback;
	}
	const parsed = dayjs(value);
	return parsed.isValid() ? parsed.toISOString() : fallback;
};

const getLatestOccurredAt = (left: string, right: string): string =>
	dayjs(left).valueOf() >= dayjs(right).valueOf() ? left : right;

const findEpisodeWatchDate = (
	activities: Array<z.infer<typeof watcharrActivitySchema>>,
	season: number,
	episode: number,
	fallback: string,
) => {
	let matchedOccurredAt: string | undefined;
	for (const activity of activities) {
		if (!activity.type.includes("EPISODE") || !activity.data) {
			continue;
		}
		try {
			const parsed = watcharrActivityDataSchema.safeParse(JSON.parse(activity.data) as unknown);
			if (parsed.success && parsed.data.season === season && parsed.data.episode === episode) {
				const occurredAt = normalizeOccurredAt(activity.customDate, fallback);
				matchedOccurredAt = matchedOccurredAt
					? getLatestOccurredAt(matchedOccurredAt, occurredAt)
					: occurredAt;
			}
		} catch {}
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
	const groupMap = new Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>();

	for (let itemIndex = 0; itemIndex < parsed.length; itemIndex++) {
		const rawItem = parsed[itemIndex];
		const parsedItem = watcharrItemSchema.safeParse(rawItem);
		if (!parsedItem.success) {
			failures.push({
				itemIndex,
				message: "Watcharr item is malformed",
				context: { issues: parsedItem.error.issues.map((issue) => issue.path.join(".")) },
			});
			continue;
		}

		const item = parsedItem.data;
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

		const importedAt = dayjs().toISOString();
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
					properties: {
						progressPercent: 100,
						showSeason: episode.seasonNumber,
						showEpisode: episode.episodeNumber,
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
