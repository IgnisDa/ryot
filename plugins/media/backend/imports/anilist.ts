import { Result, Schema, SchemaIssue } from "@ryot-app/sandbox-sdk/effect";

import { anilistListState } from "../lib/anilist-list";
import { nowIso, parseZonedDateTime } from "./dates";
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
	normalizeRating,
} from "./helpers";
import type { MediaImportAdapterFailure } from "./schemas";

export const AnilistList = Schema.Struct({
	id: Schema.Int,
	score: Schema.Finite,
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
	score: Schema.Finite,
	series_id: Schema.Int,
	summary: Schema.String,
	series_type: Schema.Int,
	updated_at: Schema.String,
});
const AnilistFavorite = Schema.Struct({ favourite_id: Schema.Int, favourite_type: Schema.Int });
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
const decodeRoot = Schema.decodeUnknownSync(AnilistRoot);
const decodeList = Schema.decodeUnknownResult(AnilistList);
const decodeReview = Schema.decodeUnknownResult(AnilistReview);
const decodeFavorite = Schema.decodeUnknownResult(AnilistFavorite);
const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();
const issuePaths = (error: Schema.SchemaError) =>
	formatIssue(error.issue).issues.map((issue) =>
		(issue.path ?? [])
			.map((segment) => String(typeof segment === "object" ? segment.key : segment))
			.join("."),
	);
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
const getFavoriteTarget = (favoriteType: number) => getSeriesTarget(favoriteType - 1);
const parseAnilistDate = (value: string | null | undefined, timezone: string) =>
	value ? parseZonedDateTime(value, ["YYYY-MM-DD HH:mm:ss"], timezone) : null;
const getLifecycle = (status: string | undefined) => {
	const state = anilistListState(status?.trim().toUpperCase() ?? "");
	return state === "in_progress" ? "progress" : state;
};
const parseCustomListIds = (value: string | null | undefined) => {
	const raw = value?.trim();
	if (!raw) {
		return [];
	}
	const parsed = Result.try(() => JSON.parse(raw) as unknown);
	return Result.isSuccess(parsed) && Array.isArray(parsed.success)
		? parsed.success.filter(
				(entry): entry is number => typeof entry === "number" && Number.isInteger(entry),
			)
		: [];
};

export const adaptAnilistExport = (
	jsonText: string,
	timezone: string,
	importedAt = nowIso(),
	coverageStart = 0,
	coverageLimit = Number.MAX_SAFE_INTEGER,
) => {
	const failures: MediaImportAdapterFailure[] = [];
	const data = decodeRoot(JSON.parse(jsonText) as unknown);
	const groupMap = new Map<string, ImportMediaEntityGroupBuilder>();
	const animeCustomLists = data.user?.custom_lists?.anime ?? [];
	const mangaCustomLists = data.user?.custom_lists?.manga ?? [];
	let itemIndex = 0;
	for (const rawItem of data.lists ?? []) {
		const parsed = decodeList(rawItem);
		if (Result.isFailure(parsed)) {
			failures.push({
				itemIndex,
				message: "Anilist list item is malformed",
				context: { issues: issuePaths(parsed.failure) },
			});
			itemIndex += 1;
			continue;
		}
		const item = parsed.success;
		if (!Number.isSafeInteger(item.progress) || item.progress < 0) {
			failures.push({ itemIndex, message: "AniList progress count is invalid" });
			itemIndex++;
			continue;
		}
		const target = getSeriesTarget(item.series_type);
		if (!target) {
			failures.push({
				itemIndex,
				sourceIdentifier: String(item.series_id),
				message: `Unsupported AniList series type: ${item.series_type}`,
			});
			itemIndex += 1;
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
		for (
			let progress = coverageStart + 1;
			progress <= Math.min(item.progress, coverageStart + coverageLimit);
			progress++
		) {
			group.events.push({
				occurredAt,
				eventSchemaSlug: "progress",
				properties:
					target.entitySchemaSlug === "anime"
						? { progressPercent: 100, animeEpisode: progress }
						: { progressPercent: 100, mangaChapter: progress },
			});
		}
		if (coverageStart + coverageLimit < item.progress) {
			itemIndex++;
			continue;
		}
		const lifecycle = getLifecycle(item.status);
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
			target.entitySchemaSlug === "anime" ? animeCustomLists : mangaCustomLists;
		for (const listId of parseCustomListIds(item.custom_lists)) {
			const listName = customListNames[listId];
			if (listName) {
				addCollectionMembership(group, listName);
			}
		}
		itemIndex += 1;
	}
	for (const rawReview of data.reviews ?? []) {
		const parsed = decodeReview(rawReview);
		if (Result.isFailure(parsed)) {
			failures.push({
				itemIndex,
				message: "Anilist review item is malformed",
				context: { issues: issuePaths(parsed.failure) },
			});
			itemIndex += 1;
			continue;
		}
		const review = parsed.success;
		const target = getSeriesTarget(review.series_type);
		if (!target) {
			failures.push({
				itemIndex,
				sourceIdentifier: String(review.series_id),
				message: `Unsupported AniList series type: ${review.series_type}`,
			});
			itemIndex += 1;
			continue;
		}
		const sourceLabel = `${target.sourceLabelPrefix} ${review.series_id}`;
		const group = getOrCreateMediaEntityGroup(
			groupMap,
			{
				sourceLabel,
				kind: "resolved",
				providerSlug: target.providerSlug,
				externalId: String(review.series_id),
				entitySchemaSlug: target.entitySchemaSlug,
			},
			itemIndex,
		);
		const event = createReviewEvent({
			text: `${review.summary}\n\n${review.text}`,
			rating: normalizeRating(String(review.score)),
			occurredAt: parseAnilistDate(review.updated_at, timezone) ?? importedAt,
		});
		if (event) {
			group.events.push(event);
		}
		itemIndex += 1;
	}
	for (const rawFavorite of data.favourites ?? []) {
		const parsed = decodeFavorite(rawFavorite);
		if (Result.isFailure(parsed)) {
			failures.push({
				itemIndex,
				message: "Anilist favorite item is malformed",
				context: { issues: issuePaths(parsed.failure) },
			});
			itemIndex += 1;
			continue;
		}
		const favorite = parsed.success;
		const target = getFavoriteTarget(favorite.favourite_type);
		if (!target) {
			failures.push({
				itemIndex,
				sourceIdentifier: String(favorite.favourite_id),
				message: `Unsupported AniList favorite type: ${favorite.favourite_type}`,
			});
			itemIndex += 1;
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
		itemIndex += 1;
	}
	return { failures, totalItems: itemIndex, entityGroups: finalizeEntityGroups(groupMap.values()) };
};
