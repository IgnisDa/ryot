import type { SavedViewLayouts } from "@ryot/contract/modules/saved-views/schemas";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	collectManagedAssets,
	decodeSavedViewCardData,
	decodeSavedViewTableData,
	resolveSavedViewImageUrl,
	resolvedAssetUrls,
} from "./display-data";

const queryDocument = { queries: {} } as const;
const layouts = {
	grid: {
		queryDocument,
		itemIdField: "gridId",
		titleField: "gridTitle",
		imageField: "gridImage",
		calloutField: "gridCallout",
		overlineField: "gridOverline",
		primaryMetadataField: "gridPrimary",
		secondaryMetadataField: "gridSecondary",
	},
	list: {
		queryDocument,
		calloutField: null,
		overlineField: null,
		itemIdField: "listId",
		titleField: "listTitle",
		imageField: "listImage",
		primaryMetadataField: null,
		secondaryMetadataField: null,
	},
	table: {
		queryDocument,
		itemIdField: "tableId",
		imageField: "tableImage",
		columns: [
			{ field: "tableTitle", label: "Title" },
			{ field: "tableYear", label: "Year" },
		],
	},
} satisfies SavedViewLayouts;

const response = (item: unknown) => ({
	data: {
		active: {
			type: "rows",
			items: [item],
			pageInfo: { page: 1, limit: 20, total: 1, hasMore: false },
		},
	},
});

describe("saved-view display data", () => {
	it("decodes only the selected card layout", () => {
		const decoded = Result.getOrThrow(
			decodeSavedViewCardData(
				response({
					gridId: { kind: "text", value: "grid-1" },
					gridCallout: { kind: "number", value: 4.5 },
					gridSecondary: { kind: "boolean", value: true },
					gridTitle: { kind: "text", value: "Grid title" },
					gridPrimary: { kind: "date", value: "2026-08-12" },
					gridOverline: { kind: "text", value: "Grid overline" },
					gridImage: {
						kind: "json",
						value: { type: "remote", url: "https://example.com/grid.jpg" },
					},
				}),
				layouts.grid,
			),
		);

		expect(decoded.items).toEqual([
			{
				id: "grid-1",
				title: "Grid title",
				callout: { kind: "number", value: 4.5 },
				overline: { kind: "text", value: "Grid overline" },
				secondaryMetadata: { kind: "boolean", value: true },
				primaryMetadata: { kind: "date", value: "2026-08-12" },
				image: { type: "asset", locator: { type: "remote", url: "https://example.com/grid.jpg" } },
			},
		]);
	});

	it("ignores missing and malformed inactive layout fields", () => {
		const decoded = decodeSavedViewCardData(
			response({
				listImage: { kind: "null", value: null },
				gridTitle: { kind: "number", value: 123 },
				listId: { kind: "text", value: "list-1" },
				listTitle: { kind: "text", value: "List title" },
			}),
			layouts.list,
		);

		expect(Result.getOrThrow(decoded).items).toEqual([
			{
				id: "list-1",
				callout: undefined,
				title: "List title",
				overline: undefined,
				image: { type: "missing" },
				primaryMetadata: undefined,
				secondaryMetadata: undefined,
			},
		]);
	});

	it("decodes the selected table mapping and preserves duplicate labels", () => {
		const table = {
			...layouts.table,
			columns: [
				{ field: "tableTitle", label: "Value" },
				{ field: "tableYear", label: "Value" },
			],
		} satisfies SavedViewLayouts["table"];
		const decoded = Result.getOrThrow(
			decodeSavedViewTableData(
				response({
					tableYear: { kind: "null", value: null },
					tableId: { kind: "text", value: "table-1" },
					tableTitle: { kind: "text", value: "Table title" },
					tableImage: { kind: "json", value: { type: "s3", key: "table.jpg" } },
				}),
				table,
			),
		);

		expect(decoded.items[0]).toEqual({
			id: "table-1",
			image: { type: "asset", locator: { type: "s3", key: "table.jpg" } },
			cells: [
				{ key: "tableTitle", label: "Value", value: { kind: "text", value: "Table title" } },
				{ key: "tableYear", label: "Value", value: { kind: "null", value: null } },
			],
		});
	});

	it("collects assets only from active items and resolves URLs", () => {
		const item = Result.getOrThrow(
			decodeSavedViewCardData(
				response({
					listId: { kind: "text", value: "list-1" },
					listTitle: { kind: "text", value: "List title" },
					listImage: { kind: "json", value: { type: "local", key: "cover.jpg" } },
				}),
				layouts.list,
			),
		).items[0];
		const assets = collectManagedAssets([item, item]);
		const urls = resolvedAssetUrls(
			[
				{
					asset: { type: "local", key: "cover.jpg" },
					downloadUrl: "uploads/local/download?key=cover.jpg",
				},
			],
			"https://server.test",
		);

		expect(assets).toEqual([{ type: "local", key: "cover.jpg" }]);
		expect(resolveSavedViewImageUrl(item.image, urls)).toBe(
			"https://server.test/api/uploads/local/download?key=cover.jpg",
		);
	});

	it("rejects malformed selected layout fields and multiple results", () => {
		expect(
			Result.isFailure(
				decodeSavedViewCardData(
					response({
						gridId: { kind: "text", value: "grid-1" },
						gridTitle: { kind: "boolean", value: true },
					}),
					{ ...layouts.grid, imageField: null },
				),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeSavedViewTableData(
					{ data: { first: response({}).data.active, second: response({}).data.active } },
					layouts.table,
				),
			),
		).toBe(true);
	});
});
