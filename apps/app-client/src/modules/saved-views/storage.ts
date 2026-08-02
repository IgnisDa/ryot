import { normalizeServerOrigin } from "@/api/origin";
import type { ApiScope } from "@/api/request-key";

export type SavedViewLayoutStorageScope = ApiScope & {
	viewSlug: string;
};

export type SavedViewLayout = "grid" | "list" | "table";

export const savedViewLayoutStorageKey = (scope: SavedViewLayoutStorageScope) =>
	`saved-view-layout:${JSON.stringify([
		normalizeServerOrigin(scope.serverUrl),
		scope.userId,
		scope.viewSlug,
	])}`;
