import type { ApiScope } from "@/api/request-key";
import { normalizeServerOrigin } from "@/modules/server/url";

export type SavedViewLayoutStorageScope = ApiScope & {
	viewSlug: string;
};

export const savedViewLayoutStorageKey = (scope: SavedViewLayoutStorageScope) =>
	`saved-view-layout:${JSON.stringify([
		normalizeServerOrigin(scope.serverUrl),
		scope.userId,
		scope.viewSlug,
	])}`;
