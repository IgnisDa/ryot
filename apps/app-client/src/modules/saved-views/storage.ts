import { normalizeServerOrigin } from "@/modules/server/url";

export type SavedViewLayoutStorageScope = {
	userId: string;
	viewSlug: string;
	serverUrl: string;
};

export const savedViewLayoutStorageKey = (scope: SavedViewLayoutStorageScope) =>
	`saved-view-layout:${JSON.stringify([
		normalizeServerOrigin(scope.serverUrl),
		scope.userId,
		scope.viewSlug,
	])}`;
