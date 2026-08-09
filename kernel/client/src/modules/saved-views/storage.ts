import type { ApiScope } from "@/api/request-key";
import { scopedStorageKey } from "@/persistence/keys";

export type SavedViewLayoutStorageScope = ApiScope & {
	viewSlug: string;
};

export type SavedViewLayout = "grid" | "list" | "table";

export const savedViewLayoutStorageKey = (scope: SavedViewLayoutStorageScope) =>
	scopedStorageKey("saved-view-layout", scope, scope.viewSlug);
