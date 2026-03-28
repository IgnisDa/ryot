import type { SavedViewLayouts } from "@ryot/contract/modules/saved-views/schemas";
import { SavedViewId } from "@ryot/contract/schema/brands";
import type { SavedViewRecord } from "@ryot/ryotql-recipes/saved-view-records";
import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vitest";

import { mapManagedAssetResolution, mapSavedViewRecord, mapSavedViewResult } from "./state";

const queryDocument = { queries: {} } as const;
const layouts = {
	grid: {
		queryDocument,
		calloutField: null,
		overlineField: null,
		imageField: "image",
		titleField: "title",
		entityIdField: "entityId",
		primaryMetadataField: null,
		secondaryMetadataField: null,
	},
	list: {
		queryDocument,
		imageField: null,
		calloutField: null,
		overlineField: null,
		titleField: "title",
		entityIdField: "entityId",
		primaryMetadataField: null,
		secondaryMetadataField: null,
	},
	table: {
		queryDocument,
		imageField: null,
		entityIdField: "entityId",
		columns: [{ field: "title", label: "Title" }],
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
	id: SavedViewId.make("view-1"),
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
} satisfies SavedViewRecord;

const rows = (items: readonly unknown[]) => ({
	data: {
		view: {
			items,
			type: "rows",
			pageInfo: { page: 1, limit: 20, total: items.length, hasMore: false },
		},
	},
});

const recordResponse = (items: readonly unknown[]) => ({
	data: {
		savedView: {
			items,
			type: "rows",
			pageInfo: { page: 1, limit: 1, total: items.length, hasMore: false },
		},
	},
});

const recordItem = {
	id: { kind: "text", value: "view-1" },
	layouts: { kind: "json", value: layouts },
	pluginSlug: { kind: "null", value: null },
	slug: { kind: "text", value: record.slug },
	name: { kind: "text", value: record.name },
	icon: { kind: "text", value: record.icon },
	createdAt: { kind: "date", value: record.createdAt },
	updatedAt: { kind: "date", value: record.updatedAt },
	sortOrder: { kind: "number", value: record.sortOrder },
	isBuiltin: { kind: "boolean", value: record.isBuiltin },
	isDisabled: { kind: "boolean", value: record.isDisabled },
};

describe("saved-view application state", () => {
	it("maps record loading, transport failure, malformed, and not-found", () => {
		expect(mapSavedViewRecord(AsyncResult.initial())).toEqual({ status: "loading" });
		expect(mapSavedViewRecord(AsyncResult.fail("offline")).status).toBe("transport-error");
		expect(mapSavedViewRecord(AsyncResult.success({ data: {} })).status).toBe("malformed");
		expect(mapSavedViewRecord(AsyncResult.success(recordResponse([])))).toEqual({
			status: "not-found",
		});
		expect(mapSavedViewRecord(AsyncResult.success(recordResponse([recordItem])))).toMatchObject({
			status: "ready",
			record: { slug: "favorites" },
		});
	});

	it("maps card success and empty results with derived entity and asset state", () => {
		const ready = mapSavedViewResult(
			AsyncResult.success(
				rows([
					{
						title: { kind: "text", value: "First" },
						entityId: { kind: "text", value: "entity-1" },
						image: { kind: "json", value: { type: "local", key: "cover.jpg" } },
					},
				]),
			),
			record,
			"grid",
		);
		expect(ready).toMatchObject({
			layout: "grid",
			status: "ready",
			entityIds: ["entity-1"],
			assets: [{ type: "local", key: "cover.jpg" }],
		});
		expect(mapSavedViewResult(AsyncResult.success(rows([])), record, "list")).toMatchObject({
			layout: "list",
			status: "ready",
			data: { items: [] },
		});
	});

	it("keeps table results typed and maps failures", () => {
		expect(mapSavedViewResult(AsyncResult.initial(), record, "table")).toEqual({
			status: "loading",
		});
		expect(
			mapSavedViewResult(
				AsyncResult.success(
					rows([
						{
							title: { kind: "text", value: "First" },
							entityId: { kind: "text", value: "entity-1" },
						},
					]),
				),
				record,
				"table",
			),
		).toMatchObject({
			status: "ready",
			layout: "table",
			data: { items: [{ entityId: "entity-1" }] },
		});
		expect(mapSavedViewResult(AsyncResult.fail("offline"), record, "grid").status).toBe(
			"transport-error",
		);
		expect(
			mapSavedViewResult(
				AsyncResult.success(rows([{ title: { kind: "number", value: 1 } }])),
				record,
				"grid",
			).status,
		).toBe("malformed");
	});

	it("keeps managed asset loading and failure non-fatal", () => {
		expect(mapManagedAssetResolution(AsyncResult.initial(), "https://server.test")).toEqual({
			urls: new Map(),
			status: "loading",
		});
		expect(
			mapManagedAssetResolution(AsyncResult.failure(Cause.fail("offline")), "https://server.test"),
		).toMatchObject({ status: "unavailable", urls: new Map() });
	});
});
