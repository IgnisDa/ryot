import type { Formatters } from "@ryot-app/plugin-client-sdk/react";

import {
	VIEWING_REGION_SETTING,
	type WatchProvider,
	type WatchProviderList,
	type WatchProviderOffer,
	watchProviderOffers,
} from "../../shared/watch-provider";
import type { MediaImageAsset } from "./image";

export type MediaWatchProviders = { readonly watchProviders: WatchProviderList };

export type WatchProviderGroup = {
	readonly offer: WatchProviderOffer;
	readonly providers: readonly WatchProvider[];
};

const regionAvailability = (media: MediaWatchProviders, region: string | undefined) =>
	region === undefined
		? undefined
		: (media.watchProviders ?? []).find((entry) => entry?.country === region);

export const viewerRegion = (settings?: Readonly<Record<string, unknown>>) => {
	const region = settings?.[VIEWING_REGION_SETTING];
	return typeof region === "string" && region !== "auto"
		? region
		: new Intl.Locale(new Intl.Collator().resolvedOptions().locale).region;
};

export const regionLabel = (formatters: Formatters, region: string) =>
	formatters.displayNames({ type: "region" }).of(region) ?? region;

export const watchProviderGroups = (
	media: MediaWatchProviders,
	region: string | undefined,
): readonly WatchProviderGroup[] => {
	const availability = regionAvailability(media, region);
	if (availability?.providers === undefined || availability.providers === null) {
		return [];
	}
	const providers = availability.providers
		.filter((provider) => provider !== null)
		.sort((left, right) => left.name.localeCompare(right.name));
	return watchProviderOffers.flatMap((offer) => {
		const offered = providers.filter((provider) => provider.offers?.includes(offer) === true);
		return offered.length === 0 ? [] : [{ offer, providers: offered }];
	});
};

export const watchProviderLink = (media: MediaWatchProviders, region: string | undefined) =>
	regionAvailability(media, region)?.link ?? undefined;

export const watchProviderAsset = (provider: WatchProvider): undefined | MediaImageAsset =>
	provider.image === null || provider.image === undefined
		? undefined
		: { type: "remote", url: provider.image };
