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
	normalizeRating,
	parseDateTime,
} from "../../media/book/shared";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/import-processor";

const anilistListSchema = z.object({
	score: z.number(),
	id: z.number().int(),
	progress: z.number().int(),
	series_id: z.number().int(),
	status: z.string().optional(),
	series_type: z.number().int(),
	progress_volume: z.number().int(),
	notes: z.string().nullable().optional(),
	updated_at: z.string().nullable().optional(),
	custom_lists: z.string().nullable().optional(),
});

const anilistReviewSchema = z.object({
	text: z.string(),
	score: z.number(),
	summary: z.string(),
	id: z.number().int(),
	updated_at: z.string(),
	series_id: z.number().int(),
	series_type: z.number().int(),
});

const anilistFavoriteSchema = z.object({
	favourite_id: z.number().int(),
	favourite_type: z.number().int(),
});

const anilistRootSchema = z.object({
	lists: z.array(z.unknown()).optional(),
	reviews: z.array(z.unknown()).optional(),
	favourites: z.array(z.unknown()).optional(),
	user: z
		.object({
			custom_lists: z
				.object({ anime: z.array(z.string()).optional(), manga: z.array(z.string()).optional() })
				.optional(),
		})
		.optional(),
});

const getSeriesTarget = (seriesType: number) => {
	if (seriesType === 0) {
		return {
			sourceLabelPrefix: "Anime",
			entitySchemaSlug: "anime" as const,
			scriptSlug: "anime.anilist" as const,
		};
	}
	if (seriesType === 1) {
		return {
			sourceLabelPrefix: "Manga",
			entitySchemaSlug: "manga" as const,
			scriptSlug: "manga.anilist" as const,
		};
	}
	return undefined;
};

const getFavoriteTarget = (favoriteType: number) => {
	if (favoriteType === 1) {
		return {
			sourceLabelPrefix: "Anime",
			entitySchemaSlug: "anime" as const,
			scriptSlug: "anime.anilist" as const,
		};
	}
	if (favoriteType === 2) {
		return {
			sourceLabelPrefix: "Manga",
			entitySchemaSlug: "manga" as const,
			scriptSlug: "manga.anilist" as const,
		};
	}
	return undefined;
};

const parseAnilistDate = (value: string | null | undefined): string | null => {
	const raw = value?.trim();
	if (!raw) {
		return null;
	}
	return parseDateTime(raw, ["YYYY-MM-DD HH:mm:ss"]);
};

const getAnilistLifecycle = (status: string | undefined) => {
	const normalized = status?.trim().toUpperCase();
	if (normalized === "CURRENT" || normalized === "REPEATING") {
		return "progress" as const;
	}
	if (normalized === "PLANNING") {
		return "backlog" as const;
	}
	if (normalized === "COMPLETED") {
		return "complete" as const;
	}
	if (normalized === "DROPPED") {
		return "dropped" as const;
	}
	if (normalized === "PAUSED") {
		return "on_hold" as const;
	}
	return undefined;
};

const parseCustomListIds = (value: string | null | undefined): number[] => {
	const raw = value?.trim();
	if (!raw) {
		return [];
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		return Array.isArray(parsed)
			? parsed.filter(
					(entry): entry is number => typeof entry === "number" && Number.isInteger(entry),
				)
			: [];
	} catch {
		return [];
	}
};

export const adaptAnilistExport = (jsonText: string): MediaImportAdapterResult => {
	const importedAt = dayjs().toISOString();
	const failures: MediaImportAdapterFailure[] = [];
	const parsedJson: unknown = JSON.parse(jsonText);
	const data = anilistRootSchema.parse(parsedJson);
	const groupMap = new Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>();

	const animeCustomLists = data.user?.custom_lists?.anime;
	const mangaCustomLists = data.user?.custom_lists?.manga;

	let itemIndex = 0;
	for (const rawItem of Array.isArray(data.lists) ? data.lists : []) {
		const parsed = anilistListSchema.safeParse(rawItem);
		if (!parsed.success) {
			failures.push({
				itemIndex,
				message: "Anilist list item is malformed",
				context: { issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
			});
			itemIndex++;
			continue;
		}

		const item = parsed.data;
		const target = getSeriesTarget(item.series_type);
		if (!target) {
			failures.push({
				itemIndex,
				sourceIdentifier: String(item.series_id),
				message: `Unsupported AniList series type: ${item.series_type}`,
			});
			itemIndex++;
			continue;
		}
		const occurredAt = parseAnilistDate(item.updated_at) ?? importedAt;
		const sourceLabel = `${target.sourceLabelPrefix} ${item.series_id}`;
		const group = getOrCreateMediaEntityGroup(
			groupMap,
			{
				sourceLabel,
				kind: "resolved",
				scriptSlug: target.scriptSlug,
				externalId: String(item.series_id),
				entitySchemaSlug: target.entitySchemaSlug,
			},
			itemIndex,
		);

		const progressCount = item.progress;
		for (let progress = 1; progress <= progressCount; progress++) {
			group.events.push({
				occurredAt,
				eventSchemaSlug: "progress",
				properties:
					target.entitySchemaSlug === "anime"
						? { progressPercent: 100, animeEpisode: progress }
						: { progressPercent: 100, mangaChapter: progress },
			});
		}
		const lifecycle = getAnilistLifecycle(item.status);
		if (lifecycle === "progress") {
			group.events.push(createProgressEvent(occurredAt));
		} else if (lifecycle === "backlog") {
			group.events.push(createBacklogEvent(occurredAt));
		} else if (lifecycle === "complete") {
			group.events.push(createCompleteEvent({ occurredAt }));
		} else if (lifecycle === "dropped") {
			group.events.push(createDroppedEvent({ occurredAt }));
		} else if (lifecycle === "on_hold") {
			group.events.push(createOnHoldEvent({ occurredAt }));
		}

		const defaultReview = createReviewEvent({
			occurredAt,
			text: item.notes ?? "",
			rating: normalizeRating(String(item.score)),
		});
		if (defaultReview) {
			group.events.push(defaultReview);
		}

		const customListNames =
			target.entitySchemaSlug === "anime" ? (animeCustomLists ?? []) : (mangaCustomLists ?? []);
		for (const listId of parseCustomListIds(item.custom_lists)) {
			const listName = customListNames[listId];
			if (listName) {
				addCollectionMembership(group, listName);
			}
		}

		itemIndex++;
	}

	for (const rawReview of Array.isArray(data.reviews) ? data.reviews : []) {
		const parsed = anilistReviewSchema.safeParse(rawReview);
		if (!parsed.success) {
			failures.push({
				itemIndex,
				message: "Anilist review item is malformed",
				context: { issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
			});
			itemIndex++;
			continue;
		}

		const review = parsed.data;
		const target = getSeriesTarget(review.series_type);
		if (!target) {
			failures.push({
				itemIndex,
				sourceIdentifier: String(review.series_id),
				message: `Unsupported AniList series type: ${review.series_type}`,
			});
			itemIndex++;
			continue;
		}
		const sourceLabel = `${target.sourceLabelPrefix} ${review.series_id}`;
		const group = getOrCreateMediaEntityGroup(
			groupMap,
			{
				sourceLabel,
				kind: "resolved",
				scriptSlug: target.scriptSlug,
				entitySchemaSlug: target.entitySchemaSlug,
				externalId: String(review.series_id),
			},
			itemIndex,
		);

		const reviewEvent = createReviewEvent({
			text: `${review.summary}\n\n${review.text}`,
			rating: normalizeRating(String(review.score)),
			occurredAt: parseAnilistDate(review.updated_at) ?? importedAt,
		});
		if (reviewEvent) {
			group.events.push(reviewEvent);
		}

		itemIndex++;
	}

	for (const rawFavorite of Array.isArray(data.favourites) ? data.favourites : []) {
		const parsed = anilistFavoriteSchema.safeParse(rawFavorite);
		if (!parsed.success) {
			failures.push({
				itemIndex,
				message: "Anilist favorite item is malformed",
				context: { issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
			});
			itemIndex++;
			continue;
		}

		const favorite = parsed.data;
		const target = getFavoriteTarget(favorite.favourite_type);
		if (!target) {
			failures.push({
				itemIndex,
				sourceIdentifier: String(favorite.favourite_id),
				message: `Unsupported AniList favorite type: ${favorite.favourite_type}`,
			});
			itemIndex++;
			continue;
		}
		const sourceLabel = `${target.sourceLabelPrefix} ${favorite.favourite_id}`;
		const group = getOrCreateMediaEntityGroup(
			groupMap,
			{
				sourceLabel,
				kind: "resolved",
				scriptSlug: target.scriptSlug,
				entitySchemaSlug: target.entitySchemaSlug,
				externalId: String(favorite.favourite_id),
			},
			itemIndex,
		);
		addCollectionMembership(group, "Favorite");
		itemIndex++;
	}

	return { entityGroups: finalizeEntityGroups(groupMap), failures };
};
