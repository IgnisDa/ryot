import type { ShowSummaryResult } from "@ryot-app/media-plugin/query-recipes";
import { Match } from "effect";
import type { AsyncResult } from "effect/unstable/reactivity";

import { classifyRyotQLResult, type MappedRyotQLResultState } from "@/api/ryotql";
import { collectManagedAssetLocators } from "@/modules/ui/managed-assets";

import { mediaImageAsset, mediaImageAssets, preferredMediaImageAsset } from "./media-image";

export type ShowSummary = NonNullable<ShowSummaryResult["show"]>;

type ShowSummaryUnavailableReason = "missing" | "unsupported";

export type ShowSummaryState = MappedRyotQLResultState<
	| { readonly status: "ready"; readonly show: ShowSummary }
	| { readonly status: "unavailable"; readonly reason: ShowSummaryUnavailableReason }
>;

type ShowSummaryFailure = Pick<
	Extract<ShowSummaryState, { status: "transport-error" | "malformed" }>,
	"status"
>;

export const mapShowSummary = (
	result: AsyncResult.AsyncResult<ShowSummaryResult, unknown>,
): ShowSummaryState => {
	const state = classifyRyotQLResult(result);
	if (state.status !== "ready") {
		return state;
	}
	const { show, entitySchemaSlug } = state.value;
	if (show === null) {
		return { status: "unavailable", reason: entitySchemaSlug === null ? "missing" : "unsupported" };
	}
	return { status: "ready", show };
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

export const showPosterAsset = (show: ShowSummary) =>
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

export const showReleaseLabel = (show: ShowSummary) =>
	show.publishYear === null ? (show.publishDate ?? undefined) : String(show.publishYear);

export const showRatingLabel = (show: ShowSummary, locales?: Intl.LocalesArgument) =>
	show.providerRating === null
		? undefined
		: new Intl.NumberFormat(locales, { maximumFractionDigits: 2 }).format(show.providerRating);

export const showLifecycleLabel = (state: ShowSummary["state"]) =>
	Match.value(state).pipe(
		Match.when("untracked", () => "Not tracked"),
		Match.when("backlog", () => "In backlog"),
		Match.when("in_progress", () => "In progress"),
		Match.when("on_hold", () => "On hold"),
		Match.when("dropped", () => "Dropped"),
		Match.when("caught_up", () => "Caught up"),
		Match.when("complete", () => "Complete"),
		Match.exhaustive,
	);

export const showOwnershipLabel = (owned: ShowSummary["owned"]) =>
	Match.value(owned).pipe(
		Match.when(null, () => "Not recorded"),
		Match.when(true, () => "Owned"),
		Match.when(false, () => "Not owned"),
		Match.exhaustive,
	);

const countLabel = (count: number, singular: string) =>
	`${count} ${count === 1 ? singular : `${singular}s`}`;

export const showSeasonCountLabel = (show: ShowSummary) =>
	show.totalSeasons === null ? undefined : countLabel(show.totalSeasons, "season");

export const showEpisodeCountLabel = (show: ShowSummary) =>
	show.totalEpisodes === null ? undefined : countLabel(show.totalEpisodes, "episode");

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
	return pageInfo.hasMore ? `${items.length}+ collections` : countLabel(items.length, "collection");
};
