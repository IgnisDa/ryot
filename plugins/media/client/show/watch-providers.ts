import {
	watchProviderOffers,
	type WatchProvider,
	type WatchProviderOffer,
} from "../../shared/watch-provider";
import type { MediaImageAsset } from "../media-image";
import type { ShowSummary } from "./summary-state";

const OFFER_LABELS: Record<WatchProviderOffer, string> = {
	buy: "Buy",
	rent: "Rent",
	free: "Free",
	stream: "Stream",
	ads: "Free with ads",
};

export type WatchProviderGroup = {
	readonly label: string;
	readonly offer: WatchProviderOffer;
	readonly providers: readonly WatchProvider[];
};

type ShowWatchProviders = Pick<ShowSummary, "watchProviders">;

const regionAvailability = (show: ShowWatchProviders, region: string | undefined) =>
	region === undefined
		? undefined
		: (show.watchProviders ?? []).find((entry) => entry.country === region);

export const viewerRegion = () =>
	new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale).region ?? undefined;

export const regionLabel = (region: string) =>
	new Intl.DisplayNames(undefined, { type: "region" }).of(region) ?? region;

export const watchProviderGroups = (
	show: ShowWatchProviders,
	region: string | undefined,
): readonly WatchProviderGroup[] => {
	const availability = regionAvailability(show, region);
	if (availability === undefined) {
		return [];
	}
	const providers = [...availability.providers].sort((left, right) =>
		left.name.localeCompare(right.name),
	);
	return watchProviderOffers.flatMap((offer) => {
		const offered = providers.filter((provider) => provider.offers.includes(offer));
		return offered.length === 0 ? [] : [{ offer, providers: offered, label: OFFER_LABELS[offer] }];
	});
};

export const watchProviderLink = (show: ShowWatchProviders, region: string | undefined) =>
	regionAvailability(show, region)?.link ?? undefined;

export const watchProviderAsset = (provider: WatchProvider): MediaImageAsset | undefined =>
	provider.image === null ? undefined : { type: "remote", url: provider.image };
