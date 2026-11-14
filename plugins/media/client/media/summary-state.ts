import type { RyotQueryResult } from "@ryot-app/plugin-client-sdk/react";
import type { SelectedRow } from "@ryot-app/plugin-client-sdk/ryotql";

import type {
	EpisodicLifecycleState,
	MediaLifecycleState,
} from "../../shared/lifecycle-expressions";
import type {
	MediaEntitySummarySelection,
	MediaGenresList,
	MediaSummarySelection,
} from "../../shared/media-recipes";
import type { MediaActivityLogger } from "./activity-log/state";
import { mediaActivityDurationLabel } from "./activity-timeline";
import { formatDateOnlyLabel } from "./date";
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

export const mediaSourceLinks = (entity: {
	readonly sourceUrl: null | string;
	readonly providerName: null | string;
	readonly website?: null | string | undefined;
}): readonly MediaSummaryLink[] =>
	[
		{ label: "Website", href: entity.website ?? null },
		{ href: entity.sourceUrl, label: `${entity.providerName ?? "Source"} page` },
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
	readonly ownership?:
		undefined | { readonly owned: null | boolean; readonly ownedOn: null | string };
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
	media: { readonly providerRating: null | number },
	locales?: Intl.LocalesArgument,
) =>
	media.providerRating === null
		? undefined
		: new Intl.NumberFormat(locales, { maximumFractionDigits: 2 }).format(media.providerRating);

export const mediaRatingFact = (media: {
	readonly providerName: null | string;
	readonly providerRating: null | number;
}): undefined | MediaSummaryFact => {
	const value = mediaRatingLabel(media);
	return value === undefined
		? undefined
		: {
				value,
				icon: "star",
				suffix: RATING_SUFFIX,
				iconClass: "text-accent-text",
				label: media.providerName === null ? "Provider rating" : `${media.providerName} rating`,
			};
};

export const mediaSummaryStateMapper = <
	Data extends { readonly entitySchemaSlug: null | string },
	Summary,
>(input: {
	readonly title: string;
	readonly plural: string;
	readonly singular: string;
	readonly select: (value: Data) => null | Summary;
}) => ({
	loading: {
		title: `Loading ${input.singular}...`,
		detail: `Fetching the latest details for this ${input.singular}.`,
	},
	summaryUnavailable: (reason: MediaSummaryUnavailableReason) => ({
		title: `${input.title} unavailable`,
		detail:
			reason === "missing"
				? "This entity no longer exists."
				: `This entity is not a ${input.singular}, and only ${input.plural} can be opened here.`,
	}),
	summaryError: (state: MediaSummaryFailure) =>
		state.status === "transport-error"
			? {
					title: `Unable to load this ${input.singular}`,
					detail: `The server could not load this ${input.singular}. Check your connection and try again.`,
				}
			: {
					title: `Unable to display this ${input.singular}`,
					detail: `This ${input.singular} returned data that could not be displayed. Try again later.`,
				},
	mapSummary: (result: RyotQueryResult<Data>): MediaSummaryState<Summary> => {
		const state = classifyRyotQueryResult(result);
		if (state.status !== "ready") {
			return state;
		}
		const summary = input.select(state.value);
		if (summary === null) {
			return {
				status: "unavailable",
				reason: state.value.entitySchemaSlug === null ? "missing" : "unsupported",
			};
		}
		return { summary, status: "ready" };
	},
});

const MEDIA_FLAT_LIFECYCLE_LABELS: Record<MediaLifecycleState, string> = {
	on_hold: "On hold",
	dropped: "Dropped",
	complete: "Complete",
	backlog: "In backlog",
	untracked: "Not tracked",
	in_progress: "In progress",
};

export const mediaFlatLifecycleLabel = (state: MediaLifecycleState) =>
	MEDIA_FLAT_LIFECYCLE_LABELS[state];

const MEDIA_EPISODIC_LIFECYCLE_LABELS: Record<EpisodicLifecycleState, string> = {
	...MEDIA_FLAT_LIFECYCLE_LABELS,
	caught_up: "Caught up",
};

export const mediaEpisodicLifecycleLabel = (state: EpisodicLifecycleState) =>
	MEDIA_EPISODIC_LIFECYCLE_LABELS[state];

const MEDIA_LIFECYCLE_TONES: Record<EpisodicLifecycleState, MediaStatusTone> = {
	dropped: "danger",
	backlog: "neutral",
	on_hold: "warning",
	complete: "success",
	untracked: "neutral",
	caught_up: "success",
	in_progress: "accent",
};

export const mediaOwnedLabel = (ownedOn: null | string) =>
	ownedOn === null ? "Owned" : `Owned since ${formatDateOnlyLabel(ownedOn)}`;

export const mediaProductionStatusFact = (media: {
	readonly productionStatus: null | string;
}): undefined | MediaSummaryFact =>
	media.productionStatus === null
		? undefined
		: { icon: "clapperboard", label: "Production status", value: media.productionStatus };

export const mediaCountLabel = (count: number, singular: string) =>
	`${count} ${count === 1 ? singular : `${singular}s`}`;

export const mediaCountFact = (
	count: null | number,
	singular: string,
	icon: string,
): undefined | MediaSummaryFact =>
	count === null
		? undefined
		: {
				icon,
				inline: true,
				label: count === 1 ? singular : `${singular}s`,
				value: mediaCountLabel(count, singular.toLowerCase()),
			};

/** Episode progress over the aired set, e.g. "10 of 10 complete · 3 upcoming". */
export const mediaEpisodicAiredLabel = (counts: {
	readonly aired: number;
	readonly watched: number;
	readonly upcoming: number;
}) => {
	const parts = [
		counts.aired === 0 ? undefined : `${counts.watched} of ${counts.aired} complete`,
		counts.upcoming === 0 ? undefined : `${counts.upcoming} upcoming`,
	].filter((part) => part !== undefined);
	return parts.length === 0 ? undefined : parts.join(" · ");
};

export const mediaEpisodicAiredFact = (summary: {
	readonly airedEpisodes: number;
	readonly watchedEpisodes: number;
	readonly upcomingEpisodes: number;
}): undefined | MediaSummaryFact => {
	const value = mediaEpisodicAiredLabel({
		aired: summary.airedEpisodes,
		watched: summary.watchedEpisodes,
		upcoming: summary.upcomingEpisodes,
	});
	return value === undefined
		? undefined
		: { value, inline: true, label: "Progress", icon: "circle-check" };
};

export const mediaCountLabels = (count: null | number, singular: string) =>
	count === null ? [] : [mediaCountLabel(count, singular)];

export const mediaDurationFact = (duration: null | number, label: string) =>
	duration === null
		? undefined
		: { label, inline: true, icon: "clock", value: mediaActivityDurationLabel(duration) };

export const mediaDurationLabels = (duration: null | number) =>
	duration === null ? [] : [mediaActivityDurationLabel(duration)];

export const mediaCollectionsLabel = ({ items, pageInfo }: MediaCollectionList) => {
	if (items.length === 0) {
		return "Add to collection";
	}
	return pageInfo.hasMore
		? `${items.length}+ collections`
		: mediaCountLabel(items.length, "collection");
};

/** The media header: rating first and production status last around the descriptor's facts, genres as chips. */
export const mediaSummaryHeaderDetail =
	<Summary extends MediaSummaryValue & { readonly state: EpisodicLifecycleState }>(input: {
		readonly logActivity: MediaActivityLogger;
		readonly facts: (summary: Summary) => readonly MediaSummaryFact[];
		readonly progress?:
			undefined | ((summary: Summary) => undefined | { readonly percent: number });
	}) =>
	(summary: Summary): MediaSummaryHeaderDetail => ({
		links: [],
		identityDetail: mediaReleaseLabel(summary),
		chips: [
			...summary.genres.items.map(({ name }) => name),
			...(summary.genres.pageInfo.hasMore ? ["More genres"] : []),
		],
		facts: [
			mediaRatingFact(summary),
			...input.facts(summary),
			mediaProductionStatusFact(summary),
		].filter((fact) => fact !== undefined),
		rail: {
			logActivity: input.logActivity,
			ownership: { owned: summary.owned, ownedOn: summary.ownedOn },
			status: {
				progress: input.progress?.(summary),
				tone: MEDIA_LIFECYCLE_TONES[summary.state],
				label: mediaEpisodicLifecycleLabel(summary.state),
			},
		},
	});
