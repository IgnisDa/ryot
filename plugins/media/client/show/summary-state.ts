import type { RyotQueryResult } from "@ryot-app/client-sdk/react";

import type { ShowSummaryResult } from "../../shared/show-recipes";
import {
	collectManagedAssetLocators,
	mediaImageAsset,
	mediaImageAssets,
	preferredMediaImageAsset,
} from "./media-image";
import { classifyRyotQueryResult, type MappedRyotQueryState } from "./query-state";

export type ShowSummary = NonNullable<ShowSummaryResult["show"]>;

type ShowSummaryUnavailableReason = "missing" | "unsupported";

export type ShowSummaryState = MappedRyotQueryState<
	| { readonly status: "ready"; readonly show: ShowSummary }
	| { readonly status: "unavailable"; readonly reason: ShowSummaryUnavailableReason }
>;

type ShowSummaryFailure = Pick<
	Extract<ShowSummaryState, { status: "transport-error" | "malformed" }>,
	"status"
>;

export const mapShowSummary = (result: RyotQueryResult<ShowSummaryResult>): ShowSummaryState => {
	const state = classifyRyotQueryResult(result);
	if (state.status !== "ready") {
		return state;
	}
	const { show, entitySchemaSlug } = state.value;
	if (show === null) {
		return { status: "unavailable", reason: entitySchemaSlug === null ? "missing" : "unsupported" };
	}
	return { show, status: "ready" };
};

export const showSummaryError = (state: ShowSummaryFailure) =>
	state.status === "transport-error"
		? {
				title: "Unable to load this show",
				detail: "The server could not load this show. Check your connection and try again.",
			}
		: {
				title: "Unable to display this show",
				detail: "This show returned data that could not be displayed. Try again later.",
			};

export const showSummaryUnavailable = (reason: ShowSummaryUnavailableReason) => ({
	title: "Show unavailable",
	detail:
		reason === "missing"
			? "This entity no longer exists."
			: "This entity is not a show, and only shows can be opened here.",
});

const SHOW_GALLERY_LIMIT = 10;

export const showPosterAsset = (show: Pick<ShowSummary, "images">) =>
	preferredMediaImageAsset(show.images, "cover");

export const showBackdropAsset = (show: ShowSummary) => mediaImageAsset(show.images, "backdrop");

export const showGalleryAssets = (show: ShowSummary) =>
	mediaImageAssets(show.images).slice(0, SHOW_GALLERY_LIMIT);

export const showManagedAssets = (show: ShowSummary) =>
	collectManagedAssetLocators([
		showPosterAsset(show),
		showBackdropAsset(show),
		...showGalleryAssets(show),
	]);

export const showReleaseLabel = (show: Pick<ShowSummary, "publishDate" | "publishYear">) =>
	show.publishYear === null ? (show.publishDate ?? undefined) : String(show.publishYear);

export const showRatingLabel = (show: ShowSummary, locales?: Intl.LocalesArgument) =>
	show.providerRating === null
		? undefined
		: new Intl.NumberFormat(locales, { maximumFractionDigits: 2 }).format(show.providerRating);

const LIFECYCLE_LABELS: Record<ShowSummary["state"], string> = {
	on_hold: "On hold",
	dropped: "Dropped",
	complete: "Complete",
	backlog: "In backlog",
	caught_up: "Caught up",
	untracked: "Not tracked",
	in_progress: "In progress",
};

export const showLifecycleLabel = (state: ShowSummary["state"]) => LIFECYCLE_LABELS[state];

export const showOwnershipLabel = (owned: ShowSummary["owned"]) => {
	if (owned === null) {
		return "Not recorded";
	}
	return owned ? "Owned" : "Not owned";
};

export const showCountLabel = (count: number, singular: string) =>
	`${count} ${count === 1 ? singular : `${singular}s`}`;

export const showSeasonCountLabel = (show: ShowSummary) =>
	show.totalSeasons === null ? undefined : showCountLabel(show.totalSeasons, "season");

export const showEpisodeCountLabel = (show: ShowSummary) =>
	show.totalEpisodes === null ? undefined : showCountLabel(show.totalEpisodes, "episode");

const countFact = (count: number | null, singular: string) =>
	count === null
		? undefined
		: { value: String(count), label: count === 1 ? singular : `${singular}s` };

export const showSeasonFact = (show: ShowSummary) => countFact(show.totalSeasons, "Season");

export const showEpisodeFact = (show: ShowSummary) => countFact(show.totalEpisodes, "Episode");

export const showCollectionsLabel = ({ items, pageInfo }: ShowSummary["collections"]) => {
	if (items.length === 0) {
		return "Not in any collection";
	}
	return pageInfo.hasMore
		? `${items.length}+ collections`
		: showCountLabel(items.length, "collection");
};
