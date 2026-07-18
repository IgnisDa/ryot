import { fieldSyncState, type EntitySyncState } from "@ryot-app/client-ui-sdk/sync";

import type { MediaImageAsset } from "../media-image";

export type ShowSyncCounts = { readonly populating: number; readonly translating: number };

export const showSyncCounts = <Item extends EntitySyncState>(
	items: readonly Item[],
	artOf: (item: Item) => MediaImageAsset | undefined,
): ShowSyncCounts => ({
	translating: items.filter((item) => item.translationStatus === "pending").length,
	populating: items.filter((item) => fieldSyncState(artOf(item), item) === "pending").length,
});
