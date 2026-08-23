import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type {
	SavedViewCardResultItem,
	SavedViewResult,
} from "@ryot-app/ryotql-recipes/saved-views";
import { describe, expect, it } from "vitest";

import {
	appendSavedViewPage,
	createSavedViewController,
	type SavedViewData,
	type SavedViewItem,
	type SavedViewRequestToken,
	savedViewControllerReducer,
} from "./controller";

const queryDocument = { queries: {} } satisfies RyotQLDocument;
const initialPageInfo = { hasMore: true, limit: 2, nextCursor: "next" } as const;
const item = (entityId: string, title: string): SavedViewCardResultItem => ({
	title,
	entityId,
	image: null,
});
const page = (
	items: readonly SavedViewItem[],
	pageInfo: SavedViewResult<SavedViewItem>["pageInfo"] = initialPageInfo,
) => ({ items, pageInfo });
const data = (
	items: readonly SavedViewItem[],
	pages = 1,
	pageInfo: SavedViewData["pageInfo"] = initialPageInfo,
): SavedViewData => ({
	pages,
	items,
	pageInfo,
	queryDocument,
	managedUrls: new Map(),
});

describe("saved-view controller", () => {
	it("appends pages in first-seen order and keeps the latest duplicate values", () => {
		const firstPage = page([
			item("one", "One"),
			item("two", "Two, first"),
			item("two", "Two, latest on first page"),
		]);
		const latestPageInfo = { hasMore: false, limit: 2, nextCursor: null } as const;
		const secondPage = page(
			[
				item("two", "Two, latest overall"),
				item("three", "Three, first"),
				item("three", "Three, latest"),
			],
			latestPageInfo,
		);

		const firstData = appendSavedViewPage(undefined, firstPage, queryDocument, new Map());
		const appended = appendSavedViewPage(firstData, secondPage, queryDocument, new Map());

		expect(appended.items.map(({ entityId }) => entityId)).toEqual(["one", "two", "three"]);
		expect(appended.items).toEqual([
			item("one", "One"),
			item("two", "Two, latest overall"),
			item("three", "Three, latest"),
		]);
		expect(appended.pages).toBe(2);
		expect(appended.pageInfo).toBe(latestPageInfo);
	});

	it("rejects a completion from a stale identity", () => {
		const initialData = data([item("one", "One")]);
		const firstToken: SavedViewRequestToken = {
			generation: 1,
			layout: "grid",
			identity: "first",
		};
		let state = createSavedViewController({ data: initialData, identity: "first", layout: "grid" });
		state = savedViewControllerReducer(state, {
			type: "request-started",
			operation: { phase: "initial", token: firstToken },
		});
		state = savedViewControllerReducer(state, { identity: "second", type: "identity-changed" });

		const secondToken: SavedViewRequestToken = {
			generation: 2,
			layout: "grid",
			identity: "second",
		};
		state = savedViewControllerReducer(state, {
			type: "request-started",
			operation: { phase: "initial", token: secondToken },
		});
		const unchanged = savedViewControllerReducer(state, {
			token: firstToken,
			type: "request-succeeded",
			data: data([item("stale", "Stale")]),
		});

		expect(unchanged).toBe(state);
	});

	it("rejects a completion from a stale layout", () => {
		const initialData = data([item("grid", "Grid")]);
		const listToken: SavedViewRequestToken = {
			generation: 2,
			layout: "list",
			identity: "first",
		};
		let state = createSavedViewController({ data: initialData, identity: "first", layout: "grid" });
		state = savedViewControllerReducer(state, { layout: "list", type: "layout-changed" });
		state = savedViewControllerReducer(state, {
			type: "request-started",
			operation: { phase: "initial", token: listToken },
		});
		state = savedViewControllerReducer(state, { layout: "grid", type: "layout-changed" });
		const unchanged = savedViewControllerReducer(state, {
			token: listToken,
			type: "request-succeeded",
			data: data([item("stale", "Stale list")]),
		});

		expect(unchanged).toBe(state);
	});

	it("switches to a cached layout immediately", () => {
		const gridData = data([item("grid", "Grid")]);
		const listData = data([item("list", "List")]);
		const listToken: SavedViewRequestToken = {
			generation: 2,
			layout: "list",
			identity: "first",
		};
		let state = createSavedViewController({ data: gridData, identity: "first", layout: "grid" });
		state = savedViewControllerReducer(state, { layout: "list", type: "layout-changed" });
		state = savedViewControllerReducer(state, {
			type: "request-started",
			operation: { phase: "initial", token: listToken },
		});
		state = savedViewControllerReducer(state, {
			data: listData,
			token: listToken,
			type: "request-succeeded",
		});

		const switched = savedViewControllerReducer(state, { layout: "grid", type: "layout-changed" });

		expect(switched.activeLayout).toBe("grid");
		expect(switched.visible).toEqual({ data: gridData, identity: "first", layout: "grid" });
		expect(switched.visible?.data).toBe(gridData);
	});

	it("clears layout caches on identity change but keeps stale visible data until acceptance", () => {
		const initialData = data([item("grid", "Grid")]);
		const listData = data([item("list", "List")]);
		const listToken: SavedViewRequestToken = {
			generation: 2,
			layout: "list",
			identity: "first",
		};
		let state = createSavedViewController({ data: initialData, identity: "first", layout: "grid" });
		state = savedViewControllerReducer(state, { layout: "list", type: "layout-changed" });
		state = savedViewControllerReducer(state, {
			type: "request-started",
			operation: { phase: "initial", token: listToken },
		});
		state = savedViewControllerReducer(state, {
			data: listData,
			token: listToken,
			type: "request-succeeded",
		});

		const changed = savedViewControllerReducer(state, {
			identity: "second",
			type: "identity-changed",
		});

		expect(changed.layouts).toEqual({});
		expect(changed.visible).toEqual({ data: listData, identity: "first", layout: "list" });
		expect(changed.visible?.data).toBe(listData);

		const secondToken: SavedViewRequestToken = {
			layout: "list",
			identity: "second",
			generation: changed.generation + 1,
		};
		state = savedViewControllerReducer(changed, {
			type: "request-started",
			operation: { phase: "initial", token: secondToken },
		});
		const acceptedData = data([item("new", "New")]);
		state = savedViewControllerReducer(state, {
			data: acceptedData,
			token: secondToken,
			type: "request-succeeded",
		});

		expect(state.visible).toEqual({ data: acceptedData, identity: "second", layout: "list" });
	});
});
