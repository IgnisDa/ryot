import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import type { DownloadResolutionResponse } from "@ryot/contract/modules/uploads/schemas";
import {
	decodeSavedViewRecordResponse,
	type SavedViewRecord,
} from "@ryot/ryotql-recipes/saved-view-records";
import type { Cause } from "effect";
import { Result } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";

import {
	collectManagedAssets,
	decodeSavedViewCardData,
	decodeSavedViewTableData,
	resolvedAssetUrls,
	type SavedViewCardItem,
	type SavedViewDisplayData,
	type SavedViewTableItem,
} from "./display-data";
import type { SavedViewLayout } from "./saved-view-layout-selector";

export type SavedViewError = {
	readonly title: string;
	readonly detail: string;
};

export type SavedViewActiveData =
	| { readonly layout: "grid"; readonly data: SavedViewDisplayData<SavedViewCardItem> }
	| { readonly layout: "list"; readonly data: SavedViewDisplayData<SavedViewCardItem> }
	| { readonly layout: "table"; readonly data: SavedViewDisplayData<SavedViewTableItem> };

export type SavedViewResultState =
	| { readonly status: "loading" }
	| { readonly status: "malformed"; readonly cause: unknown }
	| { readonly status: "transport-error"; readonly cause: unknown }
	| ({
			readonly status: "ready";
			readonly entityIds: readonly string[];
			readonly assets: ReturnType<typeof collectManagedAssets>;
	  } & SavedViewActiveData);

export type SavedViewReadyState = Extract<SavedViewResultState, { status: "ready" }>;

type SavedViewItem = SavedViewCardItem | SavedViewTableItem;
type SavedViewPageInfo = SavedViewDisplayData<SavedViewCardItem>["pageInfo"];

export type SavedViewPage = {
	readonly pageInfo: SavedViewPageInfo;
	readonly entityIds: readonly string[];
	readonly queryDocument: RyotQLDocument;
};

export type SavedViewNormalizedState<Item extends SavedViewItem = SavedViewItem> = {
	readonly pages: readonly SavedViewPage[];
	readonly itemsById: ReadonlyMap<string, Item>;
};

export type SavedViewManagedAssetsState =
	| { readonly status: "ready"; readonly urls: ReadonlyMap<string, string> }
	| { readonly status: "loading"; readonly urls: ReadonlyMap<string, string> }
	| {
			readonly status: "unavailable";
			readonly cause: Cause.Cause<unknown>;
			readonly urls: ReadonlyMap<string, string>;
	  };

const uniqueEntityIds = (entityIds: readonly string[]) => {
	const seen = new Set<string>();
	return entityIds.filter((entityId) => {
		if (seen.has(entityId)) {
			return false;
		}
		seen.add(entityId);
		return true;
	});
};

const copySavedViewPage = (page: SavedViewPage): SavedViewPage => ({
	...page,
	entityIds: [...page.entityIds],
});

const copySavedViewItems = <Item extends SavedViewItem>(
	itemsById: ReadonlyMap<string, Item>,
	items: readonly Item[],
) => {
	const nextItemsById = new Map(itemsById);
	for (const item of items) {
		nextItemsById.set(item.entityId, item);
	}
	return nextItemsById;
};

export const appendSavedViewPage = <Item extends SavedViewItem>(
	state: SavedViewNormalizedState<Item>,
	page: SavedViewPage,
	items: readonly Item[] = [],
): SavedViewNormalizedState<Item> => ({
	itemsById: copySavedViewItems(state.itemsById, items),
	pages: [...state.pages, copySavedViewPage(page)],
});

export const patchSavedViewItems = <Item extends SavedViewItem>(
	state: SavedViewNormalizedState<Item>,
	items: readonly Item[],
): SavedViewNormalizedState<Item> => ({
	itemsById: copySavedViewItems(state.itemsById, items),
	pages: [...state.pages],
});

const materializedSavedViewItems = <Item extends SavedViewItem>(
	state: SavedViewNormalizedState<Item>,
): SavedViewItem[] => {
	const entityIds = uniqueEntityIds(state.pages.flatMap((page) => page.entityIds));
	return entityIds.flatMap((entityId) => {
		const item = state.itemsById.get(entityId);
		return item === undefined ? [] : [item];
	});
};

const deduplicateSavedViewItems = <Item extends SavedViewItem>(items: readonly Item[]) => {
	const itemsById = new Map<string, Item>();
	for (const item of items) {
		itemsById.set(item.entityId, item);
	}
	return uniqueEntityIds(items.map((item) => item.entityId)).flatMap((entityId) => {
		const item = itemsById.get(entityId);
		return item === undefined ? [] : [item];
	});
};

export const materializeSavedViewData = <Item extends SavedViewItem>(
	state: SavedViewNormalizedState<Item>,
	layout: SavedViewLayout,
): SavedViewReadyState => {
	const latestPage = state.pages.at(-1);
	if (!latestPage) {
		throw new TypeError("Saved-view data requires at least one page");
	}
	const materializedItems = materializedSavedViewItems(state);
	if (layout === "table") {
		const items = materializedItems.filter((item): item is SavedViewTableItem => "cells" in item);
		return {
			layout,
			status: "ready",
			assets: collectManagedAssets(items),
			data: { items, pageInfo: latestPage.pageInfo },
			entityIds: items.map((item) => item.entityId),
		};
	}
	const items = materializedItems.filter((item): item is SavedViewCardItem => "title" in item);
	const common = {
		status: "ready" as const,
		assets: collectManagedAssets(items),
		data: { items, pageInfo: latestPage.pageInfo },
		entityIds: items.map((item) => item.entityId),
	};
	if (layout === "grid") {
		return { ...common, layout: "grid" };
	}
	return { ...common, layout: "list" };
};

export const savedViewError = (state: {
	readonly status: "transport-error" | "malformed";
}): SavedViewError =>
	state.status === "transport-error"
		? {
				title: "Unable to load saved view",
				detail: "The server could not load this saved view. Check your connection and try again.",
			}
		: {
				title: "Unable to display saved view",
				detail: "The saved view returned data that could not be displayed. Try again later.",
			};

export const mapSavedViewRecord = (result: AsyncResult.AsyncResult<unknown, unknown>) => {
	if (AsyncResult.isFailure(result)) {
		return { status: "transport-error", cause: result.cause } as const;
	}
	if (!AsyncResult.isSuccess(result)) {
		return { status: "loading" } as const;
	}
	const decoded = decodeSavedViewRecordResponse(result.value);
	if (Result.isFailure(decoded)) {
		return { status: "malformed", cause: decoded.failure } as const;
	}
	return decoded.success === null
		? ({ status: "not-found" } as const)
		: ({ status: "ready", record: decoded.success } as const);
};

export const mapSavedViewResult = (
	result: AsyncResult.AsyncResult<unknown, unknown>,
	record: SavedViewRecord,
	layout: SavedViewLayout,
): SavedViewResultState => {
	if (AsyncResult.isFailure(result)) {
		return { status: "transport-error", cause: result.cause };
	}
	if (!AsyncResult.isSuccess(result)) {
		return { status: "loading" };
	}
	if (layout === "table") {
		const decoded = decodeSavedViewTableData(result.value, record.layouts.table);
		if (Result.isFailure(decoded)) {
			return { status: "malformed", cause: decoded.failure };
		}
		const items = deduplicateSavedViewItems(decoded.success.items);
		return {
			layout,
			status: "ready",
			data: { ...decoded.success, items },
			assets: collectManagedAssets(items),
			entityIds: items.map((item) => item.entityId),
		};
	}
	const decoded = decodeSavedViewCardData(result.value, record.layouts[layout]);
	if (Result.isFailure(decoded)) {
		return { status: "malformed", cause: decoded.failure };
	}
	const items = deduplicateSavedViewItems(decoded.success.items);
	return {
		layout,
		status: "ready",
		data: { ...decoded.success, items },
		assets: collectManagedAssets(items),
		entityIds: items.map((item) => item.entityId),
	};
};

export const mapManagedAssetResolution = (
	result: AsyncResult.AsyncResult<DownloadResolutionResponse, unknown>,
	serverUrl: string,
): SavedViewManagedAssetsState => {
	if (AsyncResult.isSuccess(result)) {
		return { status: "ready", urls: resolvedAssetUrls(result.value, serverUrl) };
	}
	if (AsyncResult.isFailure(result)) {
		return { status: "unavailable", cause: result.cause, urls: new Map() };
	}
	return { status: "loading", urls: new Map() };
};
