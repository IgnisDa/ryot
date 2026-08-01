import type { ProviderSearchResultItem } from "./search-controller";

type ProviderSearchResultItemDisplay = {
	readonly title: string;
	readonly metaText: string | undefined;
	readonly imageUrl: string | undefined;
};

const META_SEPARATOR = " \u00b7 ";

export const describeProviderSearchResultItem = (
	item: ProviderSearchResultItem,
): ProviderSearchResultItemDisplay => {
	return {
		title: item.title,
		imageUrl: item.imageUrl,
		metaText: item.metadata?.map(String).join(META_SEPARATOR),
	};
};
