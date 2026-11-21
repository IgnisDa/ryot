import type { DisplayText, Formatters, RyotQueryResult } from "@ryot-app/plugin-client-sdk/react";
import type { SelectedRow } from "@ryot-app/plugin-client-sdk/ryotql";
import { formatDuration } from "@ryot-app/plugin-ui-sdk";

import type {
	EpisodicLifecycleState,
	MediaLifecycleState,
} from "../../shared/lifecycle-expressions";
import type {
	MediaEntitySummarySelection,
	MediaGenresList,
	MediaSummarySelection,
} from "../../shared/media-recipes";
import type { CountKind, MediaCopy, MediaText } from "../messages";
import type { MediaActivityLogger } from "./activity-log/state";
import type { MediaArtworkAspect } from "./entity-presentation";
import {
	collectManagedAssetLocators,
	mediaImageAsset,
	mediaImageAssets,
	type MediaImagePurposes,
	type MediaImages,
	preferredMediaImageAsset,
} from "./image";
import { classifyRyotQueryResult, type MappedRyotQueryState } from "./query-state";

export type MediaSummaryFields = SelectedRow<MediaSummarySelection>;

export type MediaSummaryUnavailableReason = "missing" | "unsupported";

export type MediaEntitySummaryFields = SelectedRow<MediaEntitySummarySelection>;

export type MediaSummaryLink = { readonly href: string; readonly label: string };

export type MediaEntitySummaryValue = MediaEntitySummaryFields & {
	readonly collections: MediaCollectionList;
};

export type MediaCollectionList = {
	readonly items: readonly unknown[];
	readonly pageInfo: { readonly hasMore: boolean };
};

export type MediaSummaryFailure = Pick<
	Extract<MediaSummaryState<never>, { status: "malformed" | "transport-error" }>,
	"status"
>;

export type MediaSummaryValue = MediaSummaryFields & {
	readonly genres: MediaGenresList;
	readonly collections: MediaCollectionList;
};

export type MediaSummaryArtwork = {
	readonly aspect: MediaArtworkAspect;
	readonly purpose: MediaImagePurposes[number];
	readonly fit?: "cover" | "contain" | undefined;
};

export type MediaSummaryFact = {
	readonly icon: string;
	readonly label: string;
	readonly value: string;
	readonly inline?: boolean;
	readonly iconClass?: string;
	readonly suffix?: string | undefined;
};

export type MediaSummaryState<Summary> = MappedRyotQueryState<
	| { readonly status: "ready"; readonly summary: Summary }
	| { readonly status: "unavailable"; readonly reason: MediaSummaryUnavailableReason }
>;

export const mediaSourceLinks = (
	{ text, display }: MediaCopy,
	entity: {
		readonly sourceUrl: null | string;
		readonly providerName: null | DisplayText;
		readonly website?: null | string | undefined;
	},
): readonly MediaSummaryLink[] =>
	[
		{ href: entity.website ?? null, label: text("property.website") },
		{
			href: entity.sourceUrl,
			label:
				entity.providerName === null
					? text("source.page")
					: text("source.provider-page", { provider: display(entity.providerName) }),
		},
	].flatMap(({ href, label }) =>
		href !== null && /^https?:\/\//i.test(href) ? [{ href, label }] : [],
	);

export type MediaStatusTone = "accent" | "danger" | "neutral" | "success" | "warning";

export type MediaSummaryHeaderDetail = {
	readonly chips: readonly string[];
	readonly rail: MediaStatusRailConfig;
	readonly links: readonly MediaSummaryLink[];
	readonly facts: readonly MediaSummaryFact[];
	readonly identityDetail: string | undefined;
};

export type MediaStatusRailConfig = {
	readonly logActivity: undefined | MediaActivityLogger;
	readonly ownership?: undefined | { readonly owned: boolean };
	readonly status?:
		| undefined
		| {
				readonly label: string;
				readonly tone: MediaStatusTone;
				readonly progress: undefined | { readonly percent: number };
		  };
};

const MEDIA_GALLERY_LIMIT = 10;

const RATING_SUFFIX = " / 100";

type MediaImaged = { readonly images: MediaImages };

export const mediaPosterAsset = (
	media: MediaImaged,
	purpose: MediaImagePurposes[number] = "cover",
) => preferredMediaImageAsset(media.images, purpose);

export const mediaBackdropAsset = (media: MediaImaged) => mediaImageAsset(media.images, "backdrop");

export const mediaGalleryAssets = (media: MediaImaged) =>
	mediaImageAssets(media.images).slice(0, MEDIA_GALLERY_LIMIT);

export const mediaManagedAssets = (media: MediaImaged) =>
	collectManagedAssetLocators(mediaImageAssets(media.images));

export const mediaReleaseLabel = (media: {
	readonly publishDate: null | string;
	readonly publishYear: null | number;
}) => (media.publishYear === null ? (media.publishDate ?? undefined) : String(media.publishYear));

export const mediaRatingLabel = (
	formatters: Formatters,
	media: { readonly providerRating: null | number },
) =>
	media.providerRating === null
		? undefined
		: formatters.number({ maximumFractionDigits: 2 }).format(media.providerRating);

export const mediaRatingFact = (
	{ text, display, formatters }: MediaCopy,
	media: { readonly providerRating: null | number; readonly providerName: null | DisplayText },
): undefined | MediaSummaryFact => {
	const value = mediaRatingLabel(formatters, media);
	return value === undefined
		? undefined
		: {
				value,
				icon: "star",
				suffix: RATING_SUFFIX,
				iconClass: "text-accent-text",
				label:
					media.providerName === null
						? text("property.provider-rating")
						: text("summary.rating-from", { provider: display(media.providerName) }),
			};
};

export const mediaSummaryStateMapper = <
	Data extends { readonly entitySchemaSlug: null | string },
	Summary,
>(
	select: (value: Data) => null | Summary,
) => ({
	loading: (text: MediaText) => ({
		title: text("summary.loading-title"),
		detail: text("summary.loading-detail"),
	}),
	summaryUnavailable: (text: MediaText, reason: MediaSummaryUnavailableReason) => ({
		title: text("summary.unavailable-title"),
		detail:
			reason === "missing"
				? text("summary.unavailable-missing")
				: text("summary.unavailable-unsupported"),
	}),
	summaryError: (text: MediaText, state: MediaSummaryFailure) =>
		state.status === "transport-error"
			? { title: text("summary.error-load-title"), detail: text("summary.error-load-detail") }
			: {
					title: text("summary.error-display-title"),
					detail: text("summary.error-display-detail"),
				},
	mapSummary: (result: RyotQueryResult<Data>): MediaSummaryState<Summary> => {
		const state = classifyRyotQueryResult(result);
		if (state.status !== "ready") {
			return state;
		}
		const summary = select(state.value);
		if (summary === null) {
			return {
				status: "unavailable",
				reason: state.value.entitySchemaSlug === null ? "missing" : "unsupported",
			};
		}
		return { summary, status: "ready" };
	},
});

export const mediaFlatLifecycleLabel = (text: MediaText, state: MediaLifecycleState) =>
	text("summary.lifecycle", { state });

export const mediaEpisodicLifecycleLabel = (text: MediaText, state: EpisodicLifecycleState) =>
	text("summary.lifecycle", { state });

const MEDIA_LIFECYCLE_TONES: Record<EpisodicLifecycleState, MediaStatusTone> = {
	dropped: "danger",
	backlog: "neutral",
	on_hold: "warning",
	complete: "success",
	untracked: "neutral",
	caught_up: "success",
	in_progress: "accent",
};

export const mediaProductionStatusFact = (
	text: MediaText,
	media: { readonly productionStatus: null | string },
): undefined | MediaSummaryFact =>
	media.productionStatus === null
		? undefined
		: {
				icon: "clapperboard",
				value: media.productionStatus,
				label: text("property.production-status"),
			};

export const mediaCountLabel = (text: MediaText, count: number, kind: CountKind) =>
	text("count.value", { kind, count });

export const mediaCountFact = (
	text: MediaText,
	count: null | number,
	kind: CountKind,
	icon: string,
): undefined | MediaSummaryFact =>
	count === null
		? undefined
		: {
				icon,
				inline: true,
				value: mediaCountLabel(text, count, kind),
				label: text("count.fact-label", { kind, count }),
			};

/** Episode progress over the aired set, e.g. "10 of 10 complete · 3 upcoming". */
export const mediaEpisodicAiredLabel = (
	text: MediaText,
	counts: { readonly aired: number; readonly watched: number; readonly upcoming: number },
) => {
	const parts = [
		counts.aired === 0
			? undefined
			: text("summary.aired-complete", { aired: counts.aired, watched: counts.watched }),
		counts.upcoming === 0 ? undefined : text("summary.upcoming", { count: counts.upcoming }),
	].filter((part) => part !== undefined);
	return parts.length === 0 ? undefined : parts.join(" · ");
};

export const mediaEpisodicAiredFact = (
	text: MediaText,
	summary: {
		readonly airedEpisodes: number;
		readonly watchedEpisodes: number;
		readonly upcomingEpisodes: number;
	},
): undefined | MediaSummaryFact => {
	const value = mediaEpisodicAiredLabel(text, {
		aired: summary.airedEpisodes,
		watched: summary.watchedEpisodes,
		upcoming: summary.upcomingEpisodes,
	});
	return value === undefined
		? undefined
		: { value, inline: true, icon: "circle-check", label: text("primitives.progress") };
};

export const mediaCountLabels = (text: MediaText, count: null | number, kind: CountKind) =>
	count === null ? [] : [mediaCountLabel(text, count, kind)];

export const mediaDurationFact = (
	{ formatters }: MediaCopy,
	duration: null | number,
	label: string,
) =>
	duration === null
		? undefined
		: {
				label,
				inline: true,
				icon: "clock",
				value: formatDuration(formatters, duration * 60, "minute"),
			};

export const mediaDurationLabels = (formatters: Formatters, duration: null | number) =>
	duration === null ? [] : [formatDuration(formatters, duration * 60, "minute")];

export const mediaCollectionsLabel = (
	{ text }: MediaCopy,
	{ items, pageInfo }: MediaCollectionList,
) => {
	if (items.length === 0) {
		return text("collections.add");
	}
	return pageInfo.hasMore
		? text("collections.more", { count: items.length })
		: text("collections.count", { count: items.length });
};

/** The media header: rating first and production status last around the descriptor's facts, genres as chips. */
export const mediaSummaryHeaderDetail =
	<Summary extends MediaSummaryValue & { readonly state: EpisodicLifecycleState }>(input: {
		readonly logActivity: MediaActivityLogger;
		readonly facts: (summary: Summary, copy: MediaCopy) => readonly MediaSummaryFact[];
		readonly progress?:
			undefined | ((summary: Summary) => undefined | { readonly percent: number });
	}) =>
	(summary: Summary, copy: MediaCopy): MediaSummaryHeaderDetail => ({
		links: [],
		identityDetail: mediaReleaseLabel(summary),
		chips: [
			...summary.genres.items.map(({ name }) => name),
			...(summary.genres.pageInfo.hasMore ? [copy.text("summary.more-genres")] : []),
		],
		facts: [
			mediaRatingFact(copy, summary),
			...input.facts(summary, copy),
			mediaProductionStatusFact(copy.text, summary),
		].filter((fact) => fact !== undefined),
		rail: {
			logActivity: input.logActivity,
			ownership: { owned: summary.owned },
			status: {
				progress: input.progress?.(summary),
				tone: MEDIA_LIFECYCLE_TONES[summary.state],
				label: mediaEpisodicLifecycleLabel(copy.text, summary.state),
			},
		},
	});
