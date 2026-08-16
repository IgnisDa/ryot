import type { SavedViewDisplayValue } from "@ryot/contract/modules/saved-views/schemas";
import type { AssetLocator as AssetLocatorType } from "@ryot/contract/modules/uploads/schemas";

import { collectManagedAssetLocators } from "@/modules/ui/managed-assets";

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

export const collectManagedAssets = (items: readonly (SavedViewCardItem | SavedViewTableItem)[]) =>
	collectManagedAssetLocators(
		items.map((item) => (item.image.type === "asset" ? item.image.locator : undefined)),
	);
