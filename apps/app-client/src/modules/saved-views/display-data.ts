import type { SavedViewDisplayValue } from "@ryot/contract/modules/saved-views/schemas";
import type {
	AssetLocator as AssetLocatorType,
	DownloadResolutionResponse,
	ManagedAssetLocator,
} from "@ryot/contract/modules/uploads/schemas";

import { canonicalManagedAssets, managedAssetKey } from "./managed-assets";

export type SavedViewScalarValue = SavedViewDisplayValue;

export type SavedViewImage =
	| { readonly type: "missing" }
	| { readonly type: "unconfigured" }
	| { readonly type: "asset"; readonly locator: AssetLocatorType };

export type SavedViewCardItem = {
	readonly title: string;
	readonly entityId: string;
	readonly image: SavedViewImage;
	readonly callout?: SavedViewScalarValue | undefined;
	readonly overline?: SavedViewScalarValue | undefined;
	readonly primaryMetadata?: SavedViewScalarValue | undefined;
	readonly secondaryMetadata?: SavedViewScalarValue | undefined;
};

export type SavedViewTableItem = {
	readonly entityId: string;
	readonly image: SavedViewImage;
	readonly cells: readonly {
		readonly key: string;
		readonly label: string;
		readonly value: SavedViewScalarValue;
	}[];
};

export type SavedViewDisplayData<Item extends SavedViewCardItem | SavedViewTableItem> = {
	readonly items: readonly Item[];
	readonly pageInfo: {
		readonly limit: number;
		readonly hasMore: boolean;
		readonly nextCursor: string | null;
	};
};

export const collectManagedAssets = (
	items: readonly (SavedViewCardItem | SavedViewTableItem)[],
) => {
	const assets: ManagedAssetLocator[] = [];
	for (const item of items) {
		const { image } = item;
		if (image.type === "asset" && image.locator.type !== "remote") {
			assets.push(image.locator);
		}
	}
	return canonicalManagedAssets(assets);
};

export const resolvedAssetUrls = (
	response: DownloadResolutionResponse,
	resolveUrl: (url: string) => string,
) =>
	new Map(
		response.map(({ asset, downloadUrl }) => [managedAssetKey(asset), resolveUrl(downloadUrl)]),
	);

export const resolveSavedViewImageUrl = (
	image: SavedViewImage,
	managedUrls: ReadonlyMap<string, string>,
) => {
	if (image.type !== "asset") {
		return undefined;
	}
	return image.locator.type === "remote"
		? image.locator.url
		: managedUrls.get(managedAssetKey(image.locator));
};
