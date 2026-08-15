import type { RyotQueryResult } from "@ryot-app/client-sdk/react";
import type { SelectedRow } from "@ryot-app/client-sdk/ryotql";

import type {
	EpisodicLifecycleState,
	MediaLifecycleState,
} from "../../shared/lifecycle-expressions";
import type { MediaSummarySelection } from "../../shared/media-recipes";
import { mediaActivityDurationLabel } from "./activity-timeline";
import {
	collectManagedAssetLocators,
	mediaImageAssets,
	orderedMediaImageAsset,
	preferredMediaImageAsset,
	type MediaImagePurposes,
	type MediaImages,
} from "./image";
import { classifyRyotQueryResult, type MappedRyotQueryState } from "./query-state";

export type MediaSummaryFields = SelectedRow<MediaSummarySelection>;

export type MediaSummaryUnavailableReason = "missing" | "unsupported";

export type MediaSummaryState<Summary> = MappedRyotQueryState<
	| { readonly status: "ready"; readonly summary: Summary }
	| { readonly status: "unavailable"; readonly reason: MediaSummaryUnavailableReason }
>;

export type MediaSummaryFailure = Pick<
	Extract<MediaSummaryState<never>, { status: "transport-error" | "malformed" }>,
	"status"
>;

export type MediaCollectionList = {
	readonly items: readonly unknown[];
	readonly pageInfo: { readonly hasMore: boolean };
};

export type MediaSummaryFact = {
	readonly icon: string;
	readonly label: string;
	readonly value: string;
	readonly suffix?: string | undefined;
	readonly iconClass?: string;
};

const MEDIA_GALLERY_LIMIT = 10;

const RATING_SUFFIX = " / 100";

type MediaImaged = { readonly images: MediaImages };

const DEFAULT_BACKDROP_PURPOSES: MediaImagePurposes = ["backdrop"];

export const mediaPosterAsset = (media: MediaImaged) =>
	preferredMediaImageAsset(media.images, "cover");

export const mediaBackdropAsset = (
	media: MediaImaged,
	purposes: MediaImagePurposes = DEFAULT_BACKDROP_PURPOSES,
) => orderedMediaImageAsset(media.images, purposes);

export const mediaGalleryAssets = (media: MediaImaged) =>
	mediaImageAssets(media.images).slice(0, MEDIA_GALLERY_LIMIT);

export const mediaManagedAssets = (media: MediaImaged, purposes?: MediaImagePurposes) =>
	collectManagedAssetLocators([
		mediaPosterAsset(media),
		mediaBackdropAsset(media, purposes),
		...mediaImageAssets(media.images),
	]);

export const mediaReleaseLabel = (media: {
	readonly publishDate: string | null;
	readonly publishYear: number | null;
}) => (media.publishYear === null ? (media.publishDate ?? undefined) : String(media.publishYear));

export const mediaRatingLabel = (
	media: { readonly providerRating: number | null },
	locales?: Intl.LocalesArgument,
) =>
	media.providerRating === null
		? undefined
		: new Intl.NumberFormat(locales, { maximumFractionDigits: 2 }).format(media.providerRating);

export const mediaRatingFact = (media: {
	readonly providerName: string | null;
	readonly providerRating: number | null;
}): MediaSummaryFact | undefined => {
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
	Data extends { readonly entitySchemaSlug: string | null },
	Summary,
>(input: {
	readonly title: string;
	readonly plural: string;
	readonly singular: string;
	readonly select: (value: Data) => Summary | null;
}) => ({
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

export const mediaOwnershipLabel = (owned: boolean | null) => {
	if (owned === null) {
		return "Not recorded";
	}
	return owned ? "Owned" : "Not owned";
};

export const mediaProductionStatusFact = (media: {
	readonly productionStatus: string | null;
}): MediaSummaryFact | undefined =>
	media.productionStatus === null
		? undefined
		: { icon: "clapperboard", label: "Production status", value: media.productionStatus };

export const mediaCountLabel = (count: number, singular: string) =>
	`${count} ${count === 1 ? singular : `${singular}s`}`;

export const mediaCountFact = (
	count: number | null,
	singular: string,
	icon: string,
): MediaSummaryFact | undefined =>
	count === null
		? undefined
		: { icon, value: String(count), label: count === 1 ? singular : `${singular}s` };

export const mediaCountLabels = (count: number | null, singular: string) =>
	count === null ? [] : [mediaCountLabel(count, singular)];

export const mediaDurationFact = (duration: number | null, label: string) =>
	duration === null
		? undefined
		: { label, icon: "clock", value: mediaActivityDurationLabel(duration) };

export const mediaDurationLabels = (duration: number | null) =>
	duration === null ? [] : [mediaActivityDurationLabel(duration)];

export const mediaCollectionsLabel = ({ items, pageInfo }: MediaCollectionList) => {
	if (items.length === 0) {
		return "Not in any collection";
	}
	return pageInfo.hasMore
		? `${items.length}+ collections`
		: mediaCountLabel(items.length, "collection");
};
