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
		titleField: "gridTitle",
		imageField: "gridImage",
		calloutField: "gridCallout",
		overlineField: "gridOverline",
		entityIdField: "gridEntityId",
		primaryMetadataField: "gridPrimary",
		secondaryMetadataField: "gridSecondary",
	},
	list: {
		queryDocument,
		calloutField: null,
		overlineField: null,
		titleField: "listTitle",
		imageField: "listImage",
		primaryMetadataField: null,
		secondaryMetadataField: null,
		entityIdField: "listEntityId",
	},
	table: {
		queryDocument,
		imageField: "tableImage",
		entityIdField: "tableEntityId",
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
			pageInfo: { limit: 20, hasMore: false, nextCursor: null },
		},
	},
});

describe("saved-view display data", () => {
	it("decodes only the selected card layout", () => {
		const decoded = Result.getOrThrow(
			decodeSavedViewCardData(
				response({
					gridCallout: { kind: "number", value: 4.5 },
					gridSecondary: { kind: "boolean", value: true },
					gridEntityId: { kind: "text", value: "grid-1" },
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
				entityId: "grid-1",
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
				listEntityId: { kind: "text", value: "list-1" },
				listTitle: { kind: "text", value: "List title" },
			}),
			layouts.list,
		);

		expect(Result.getOrThrow(decoded).items).toEqual([
			{
				entityId: "list-1",
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
					tableEntityId: { kind: "text", value: "table-1" },
					tableTitle: { kind: "text", value: "Table title" },
					tableImage: { kind: "json", value: { type: "s3", key: "table.jpg" } },
				}),
				table,
			),
		);

		expect(decoded.items[0]).toEqual({
			entityId: "table-1",
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
					listEntityId: { kind: "text", value: "list-1" },
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
			(url) => new URL(url, "https://server.test/api/").toString(),
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
						gridTitle: { kind: "boolean", value: true },
						gridEntityId: { kind: "text", value: "grid-1" },
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
