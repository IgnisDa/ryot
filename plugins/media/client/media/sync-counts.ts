import { fieldSyncState, type EntitySyncState } from "@ryot-app/client-ui-sdk/sync";

import type { MediaImageAsset } from "./image";

export type MediaSyncCounts = { readonly populating: number; readonly translating: number };

export const mediaSyncCounts = <Item extends EntitySyncState>(
	items: readonly Item[],
	artOf: (item: Item) => MediaImageAsset | undefined,
): MediaSyncCounts => ({
	translating: items.filter((item) => item.translationStatus === "pending").length,
	populating: items.filter((item) => fieldSyncState(artOf(item), item) === "pending").length,
});
