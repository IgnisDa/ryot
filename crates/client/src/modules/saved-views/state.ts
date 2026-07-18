import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { SavedViewRecord } from "@ryot-app/ryotql-recipes/saved-view-records";
import type {
	SavedViewCardResultItem,
	SavedViewResult,
	SavedViewTableResultItem,
} from "@ryot-app/ryotql-recipes/saved-views";
import type { AsyncResult } from "effect/unstable/reactivity";

import { classifyRyotQLResult } from "@/api/ryotql";

import {
	collectManagedAssets,
	type SavedViewCardItem,
	type SavedViewDisplayData,
	type SavedViewTableItem,
} from "./display-data";
import type { SavedViewLayout } from "./storage";

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

export type SavedViewRecordState =
	| { readonly status: "loading" }
	| { readonly status: "not-found" }
	| { readonly status: "malformed"; readonly cause: unknown }
	| { readonly status: "transport-error"; readonly cause: unknown }
	| { readonly status: "ready"; readonly record: SavedViewRecord };

type SavedViewFailure = Pick<
	Extract<SavedViewResultState, { status: "transport-error" | "malformed" }>,
	"status"
>;

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

export const savedViewError = (state: SavedViewFailure): SavedViewError =>
	state.status === "transport-error"
		? {
				title: "Unable to load saved view",
				detail: "The server could not load this saved view. Check your connection and try again.",
			}
		: {
				title: "Unable to display saved view",
				detail: "The saved view returned data that could not be displayed. Try again later.",
			};

export const mapSavedViewRecord = (
	result: AsyncResult.AsyncResult<SavedViewRecord | undefined, unknown>,
): SavedViewRecordState => {
	const state = classifyRyotQLResult(result);
	if (state.status !== "ready") {
		return state;
	}
	if (state.value === undefined) {
		return { status: "not-found" } as const;
	}
	return { status: "ready", record: state.value } as const;
};

const savedViewImage = (image: SavedViewCardResultItem["image"]) => {
	if (image === undefined) {
		return { type: "unconfigured" } as const;
	}
	if (image === null) {
		return { type: "missing" } as const;
	}
	return { type: "asset", locator: image } as const;
};

export const savedViewReadyState = (
	result: SavedViewResult<SavedViewCardResultItem | SavedViewTableResultItem>,
	layout: SavedViewLayout,
): SavedViewReadyState => {
	if (layout === "table") {
		const items = deduplicateSavedViewItems(
			result.items
				.filter((item): item is SavedViewTableResultItem => "cells" in item)
				.map((item) => Object.assign(item, { image: savedViewImage(item.image) })),
		);
		return {
			layout,
			status: "ready",
			data: { ...result, items },
			assets: collectManagedAssets(items),
			entityIds: items.map((item) => item.entityId),
		};
	}
	const items = deduplicateSavedViewItems(
		result.items
			.filter((item): item is SavedViewCardResultItem => "title" in item)
			.map((item) => Object.assign(item, { image: savedViewImage(item.image) })),
	);
	return {
		layout,
		status: "ready",
		data: { ...result, items },
		assets: collectManagedAssets(items),
		entityIds: items.map((item) => item.entityId),
	};
};
