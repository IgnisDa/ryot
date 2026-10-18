import type { EntitySyncState } from "@ryot-app/plugin-client-sdk";
import { fieldSyncState, isEnrichmentActive } from "@ryot-app/plugin-ui-sdk/sync";

import type { MediaImageAsset } from "./image";

export type MediaSyncCounts = { readonly populating: number; readonly translating: number };

export const mediaSyncCounts = <Item extends EntitySyncState>(
	items: readonly Item[],
	artOf: (item: Item) => MediaImageAsset | undefined,
): MediaSyncCounts => ({
	translating: items.filter((item) => isEnrichmentActive(item.translationStatus)).length,
	populating: items.filter((item) => fieldSyncState(artOf(item), item) === "pending").length,
});
