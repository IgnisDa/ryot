import { Either, ParseResult, Schema } from "effect";

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
} from "../../media/adapter-helpers";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/adapter-result";
import { nowIso, parseZonedDateTime } from "../../media/dates";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type { ImportMediaEntityGroup } from "../../media/types";

const AnilistList = Schema.Struct({
	id: Schema.Int,
	score: Schema.Number,
	progress: Schema.Int,
	series_id: Schema.Int,
	series_type: Schema.Int,
	progress_volume: Schema.Int,
	status: Schema.optional(Schema.String),
	notes: Schema.optional(Schema.NullOr(Schema.String)),
	updated_at: Schema.optional(Schema.NullOr(Schema.String)),
	custom_lists: Schema.optional(Schema.NullOr(Schema.String)),
});

const AnilistReview = Schema.Struct({
	id: Schema.Int,
	text: Schema.String,
	score: Schema.Number,
	series_id: Schema.Int,
	summary: Schema.String,
	series_type: Schema.Int,
	updated_at: Schema.String,
});

const AnilistFavorite = Schema.Struct({
	favourite_id: Schema.Int,
	favourite_type: Schema.Int,
});

const AnilistRoot = Schema.Struct({
	lists: Schema.optional(Schema.Array(Schema.Unknown)),
	reviews: Schema.optional(Schema.Array(Schema.Unknown)),
	favourites: Schema.optional(Schema.Array(Schema.Unknown)),
	user: Schema.optional(
		Schema.Struct({
			custom_lists: Schema.optional(
				Schema.Struct({
					anime: Schema.optional(Schema.Array(Schema.String)),
					manga: Schema.optional(Schema.Array(Schema.String)),
				}),
			),
		}),
	),
});

const decodeAnilistRoot = Schema.decodeUnknownSync(AnilistRoot);
const decodeAnilistList = Schema.decodeUnknownEither(AnilistList);
const decodeAnilistReview = Schema.decodeUnknownEither(AnilistReview);
const decodeAnilistFavorite = Schema.decodeUnknownEither(AnilistFavorite);

const issuePaths = (error: ParseResult.ParseError): string[] =>
	ParseResult.ArrayFormatter.formatErrorSync(error).map((issue) => issue.path.join("."));

const getSeriesTarget = (seriesType: number) => {
	if (seriesType === 0) {
		return {
			sourceLabelPrefix: "Anime",
			entitySchemaSlug: "anime" as const,
			providerSlug: "anime.anilist" as const,
		};
	}
	if (seriesType === 1) {
		return {
			sourceLabelPrefix: "Manga",
			entitySchemaSlug: "manga" as const,
			providerSlug: "manga.anilist" as const,
		};
	}
	return undefined;
};

const getFavoriteTarget = (favoriteType: number) => {
	if (favoriteType === 1) {
		return {
			sourceLabelPrefix: "Anime",
			entitySchemaSlug: "anime" as const,
			providerSlug: "anime.anilist" as const,
		};
	}
	if (favoriteType === 2) {
		return {
			sourceLabelPrefix: "Manga",
			entitySchemaSlug: "manga" as const,
			providerSlug: "manga.anilist" as const,
		};
	}
	return undefined;
};

const parseAnilistDate = (value: string | null | undefined, timezone: string): string | null =>
	value ? parseZonedDateTime(value, ["YYYY-MM-DD HH:mm:ss"], timezone) : null;

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
	const parsed = Either.try(() => JSON.parse(raw) as unknown);
	if (Either.isLeft(parsed)) {
		return [];
	}
	return Array.isArray(parsed.right)
		? parsed.right.filter(
				(entry): entry is number => typeof entry === "number" && Number.isInteger(entry),
			)
		: [];
};

export const adaptAnilistExport = (
	jsonText: string,
	timezone: string,
): MediaImportAdapterResult => {
	const importedAt = nowIso();
	const failures: MediaImportAdapterFailure[] = [];
	const data = decodeAnilistRoot(JSON.parse(jsonText) as unknown);
	const groupMap = new Map<string, ImportMediaEntityGroup>();

	const animeCustomLists = data.user?.custom_lists?.anime;
	const mangaCustomLists = data.user?.custom_lists?.manga;

	let itemIndex = 0;
	for (const rawItem of data.lists ?? []) {
		const parsed = decodeAnilistList(rawItem);
		if (Either.isLeft(parsed)) {
			failures.push({
				itemIndex,
				message: "Anilist list item is malformed",
				context: { issues: issuePaths(parsed.left) },
			});
			itemIndex++;
			continue;
		}

		const item = parsed.right;
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
		const occurredAt = parseAnilistDate(item.updated_at, timezone) ?? importedAt;
		const sourceLabel = `${target.sourceLabelPrefix} ${item.series_id}`;
		const group = getOrCreateMediaEntityGroup(
			groupMap,
			{
				sourceLabel,
				kind: "resolved",
				providerSlug: target.providerSlug,
				externalId: String(item.series_id),
				entitySchemaSlug: target.entitySchemaSlug,
			},
			itemIndex,
		);

		for (let progress = 1; progress <= item.progress; progress++) {
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

	for (const rawReview of data.reviews ?? []) {
		const parsed = decodeAnilistReview(rawReview);
		if (Either.isLeft(parsed)) {
			failures.push({
				itemIndex,
				message: "Anilist review item is malformed",
				context: { issues: issuePaths(parsed.left) },
			});
			itemIndex++;
			continue;
		}

		const review = parsed.right;
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
				providerSlug: target.providerSlug,
				entitySchemaSlug: target.entitySchemaSlug,
				externalId: String(review.series_id),
			},
			itemIndex,
		);

		const reviewEvent = createReviewEvent({
			text: `${review.summary}\n\n${review.text}`,
			rating: normalizeRating(String(review.score)),
			occurredAt: parseAnilistDate(review.updated_at, timezone) ?? importedAt,
		});
		if (reviewEvent) {
			group.events.push(reviewEvent);
		}

		itemIndex++;
	}

	for (const rawFavorite of data.favourites ?? []) {
		const parsed = decodeAnilistFavorite(rawFavorite);
		if (Either.isLeft(parsed)) {
			failures.push({
				itemIndex,
				message: "Anilist favorite item is malformed",
				context: { issues: issuePaths(parsed.left) },
			});
			itemIndex++;
			continue;
		}

		const favorite = parsed.right;
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
				providerSlug: target.providerSlug,
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
