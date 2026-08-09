import type { AssetLocator } from "@ryot/contract/modules/uploads/schemas";
import type { MediaImage, ShowSummaryResult } from "@ryot/media-plugin/query-recipes";
import { Match } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";

import { isRyotQLMalformedResultCause } from "@/api/ryotql";
import { canonicalManagedAssets } from "@/modules/ui/managed-assets";

export type ShowSummary = NonNullable<ShowSummaryResult["show"]>;

export type ShowSummaryUnavailableReason = "missing" | "unsupported";

export type ShowSummaryState =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly show: ShowSummary }
	| { readonly status: "malformed"; readonly cause: unknown }
	| { readonly status: "transport-error"; readonly cause: unknown }
	| { readonly status: "unavailable"; readonly reason: ShowSummaryUnavailableReason };

export type ShowSummaryError = { readonly title: string; readonly detail: string };

export const mapShowSummary = (
	result: AsyncResult.AsyncResult<ShowSummaryResult, unknown>,
): ShowSummaryState => {
	if (AsyncResult.isFailure(result)) {
		return {
			cause: result.cause,
			status: isRyotQLMalformedResultCause(result.cause) ? "malformed" : "transport-error",
		};
	}
	if (!AsyncResult.isSuccess(result)) {
		return { status: "loading" };
	}
	const { show, entitySchemaSlug } = result.value;
	if (show === null) {
		return { status: "unavailable", reason: entitySchemaSlug === null ? "missing" : "unsupported" };
	}
	return { status: "ready", show };
};

export const showSummaryError = (state: {
	readonly status: "transport-error" | "malformed";
}): ShowSummaryError =>
	state.status === "transport-error"
		? {
				title: "Unable to load this show",
				detail: "The server could not load this show. Check your connection and try again.",
			}
		: {
				title: "Unable to display this show",
				detail: "This show returned data that could not be displayed. Try again later.",
			};

export const showSummaryUnavailable = (reason: ShowSummaryUnavailableReason): ShowSummaryError => ({
	title: "Show unavailable",
	detail:
		reason === "missing"
			? "This entity no longer exists."
			: "This entity is not a show, and only shows can be opened here.",
});

const showImages = (show: ShowSummary): readonly MediaImage[] => show.images ?? [];

const imageLocator = (image: MediaImage | undefined): AssetLocator | undefined => {
	if (image === undefined) {
		return undefined;
	}
	return image.type === "remote"
		? { type: "remote", url: image.url }
		: { type: image.type, key: image.key };
};

const imageByPurpose = (images: readonly MediaImage[], purpose: MediaImage["purpose"]) =>
	images.find((image) => image.purpose === purpose);

export const showPosterAsset = (show: ShowSummary) => {
	const images = showImages(show);
	return imageLocator(imageByPurpose(images, "cover") ?? images.at(0));
};

export const showBackdropAsset = (show: ShowSummary) =>
	imageLocator(imageByPurpose(showImages(show), "backdrop"));

export const showManagedAssets = (show: ShowSummary) =>
	canonicalManagedAssets(
		[showPosterAsset(show), showBackdropAsset(show)].flatMap((asset) =>
			asset === undefined || asset.type === "remote" ? [] : [asset],
		),
	);

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
