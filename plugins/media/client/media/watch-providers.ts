import {
	watchProviderOffers,
	type WatchProvider,
	type WatchProviderList,
	type WatchProviderOffer,
} from "../../shared/watch-provider";
import type { MediaImageAsset } from "./image";

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

export type MediaWatchProviders = { readonly watchProviders: WatchProviderList };

const regionAvailability = (media: MediaWatchProviders, region: string | undefined) =>
	region === undefined
		? undefined
		: (media.watchProviders ?? []).find((entry) => entry.country === region);

export const viewerRegion = () =>
	new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale).region ?? undefined;

export const regionLabel = (region: string) =>
	new Intl.DisplayNames(undefined, { type: "region" }).of(region) ?? region;

export const watchProviderGroups = (
	media: MediaWatchProviders,
	region: string | undefined,
): readonly WatchProviderGroup[] => {
	const availability = regionAvailability(media, region);
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

export const watchProviderLink = (media: MediaWatchProviders, region: string | undefined) =>
	regionAvailability(media, region)?.link ?? undefined;

export const watchProviderAsset = (provider: WatchProvider): MediaImageAsset | undefined =>
	provider.image === null ? undefined : { type: "remote", url: provider.image };
