import type { SavedViewLayouts } from "@ryot/contract/modules/saved-views/schemas";
import { SavedViewId } from "@ryot/contract/schema/brands";
import type { SavedViewRecord } from "@ryot/ryotql-recipes/saved-view-records";
import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vitest";

import { RyotQLMalformedResultError } from "@/api/ryotql";

import type { SavedViewCardItem, SavedViewTableItem } from "./display-data";
import {
	appendSavedViewPage,
	mapManagedAssetResolution,
	mapSavedViewRecord,
	materializeSavedViewData,
	savedViewReadyState,
	type SavedViewNormalizedState,
	type SavedViewPage,
} from "./state";

const queryDocument = { queries: {} } as const;
const layouts = {
	grid: {
		callout: null,
		overline: null,
		imageField: "image",
		titleField: "title",
		entityIdField: "entityId",
		primaryMetadata: null,
		queryDocument,
		secondaryMetadata: null,
	},
	list: {
		callout: null,
		overline: null,
		imageField: null,
		titleField: "title",
		entityIdField: "entityId",
		primaryMetadata: null,
		queryDocument,
		secondaryMetadata: null,
	},
	table: {
		imageField: null,
		entityIdField: "entityId",
		queryDocument,
		columns: [{ field: "title", label: "Title", displayKind: "text" }],
	},
} satisfies SavedViewLayouts;
const record = {
	layouts,
	icon: "star",
	sortOrder: 0,
	pluginSlug: null,
	isBuiltin: false,
	slug: "favorites",
	name: "Favorites",
	isDisabled: false,
	entitySchemaSlug: null,
	id: SavedViewId.make("view-1"),
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
} satisfies SavedViewRecord;

const result = <Item>(items: readonly Item[]) => ({
	items,
	pageInfo: { limit: 20, hasMore: false, nextCursor: null },
});
const page = (entityIds: readonly string[], nextCursor: string | null = null): SavedViewPage => ({
	entityIds,
	queryDocument,
	pageInfo: { hasMore: nextCursor !== null, limit: 20, nextCursor },
});
const card = (entityId: string, title: string): SavedViewCardItem => ({
	title,
	entityId,
	image: { type: "missing" },
});
const table = (entityId: string, value: string): SavedViewTableItem => ({
	entityId,
	image: { type: "unconfigured" },
	cells: [{ key: "title", label: "Title", value: { displayKind: "text", value } }],
});
const empty = <
	Item extends SavedViewCardItem | SavedViewTableItem,
>(): SavedViewNormalizedState<Item> => ({ pages: [], itemsById: new Map() });

describe("saved-view application state", () => {
	it("maps decoded record states and keeps malformed failures distinct", () => {
		expect(mapSavedViewRecord(AsyncResult.initial())).toEqual({ status: "loading" });
		expect(mapSavedViewRecord(AsyncResult.fail("offline")).status).toBe("transport-error");
		expect(
			mapSavedViewRecord(AsyncResult.fail(new RyotQLMalformedResultError("invalid"))).status,
		).toBe("malformed");
		expect(mapSavedViewRecord(AsyncResult.success(undefined))).toEqual({ status: "not-found" });
		expect(mapSavedViewRecord(AsyncResult.success(record))).toMatchObject({
			status: "ready",
			record: { slug: "favorites" },
		});
	});

	it("maps decoded card and table results with image state", () => {
		const cardState = savedViewReadyState(
			result([
				{ title: "First", entityId: "entity-1", image: { type: "local", key: "cover.jpg" } },
			]),
			"grid",
		);
		const tableState = savedViewReadyState(
			result([
				{ entityId: "entity-2", image: undefined, cells: table("entity-2", "Second").cells },
			]),
			"table",
		);

		expect(cardState).toMatchObject({
			status: "ready",
			entityIds: ["entity-1"],
			assets: [{ type: "local", key: "cover.jpg" }],
		});
		expect(tableState).toMatchObject({
			status: "ready",
			data: { items: [{ image: { type: "unconfigured" } }] },
		});
	});

	it("keeps managed asset loading and failure non-fatal", () => {
		expect(mapManagedAssetResolution(AsyncResult.initial(), (url) => url)).toEqual({
			urls: new Map(),
			status: "loading",
		});
		expect(
			mapManagedAssetResolution(AsyncResult.failure(Cause.fail("offline")), (url) => url),
		).toMatchObject({ status: "unavailable", urls: new Map() });
	});

	it("deduplicates pages and keeps the latest item", () => {
		const state = appendSavedViewPage(
			appendSavedViewPage(empty<SavedViewCardItem>(), page(["entity-1", "entity-2"]), [
				card("entity-1", "First"),
				card("entity-2", "Second"),
			]),
			page(["entity-2", "entity-3"]),
			[card("entity-2", "Updated"), card("entity-3", "Third")],
		);
		const materialized = materializeSavedViewData(state, "list");

		expect(materialized.entityIds).toEqual(["entity-1", "entity-2", "entity-3"]);
		expect(materialized.data.items).toMatchObject([
			{ title: "First" },
			{ title: "Updated" },
			{ title: "Third" },
		]);
	});
});
