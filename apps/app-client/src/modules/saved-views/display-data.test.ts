import type { SavedViewDisplayConfiguration } from "@ryot/contract/modules/saved-views/schemas";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	collectManagedAssets,
	decodeSavedViewDisplayData,
	resolveSavedViewImageUrl,
	resolvedAssetUrls,
} from "./display-data";

const configuration = {
	entityIdField: "id",
	grid: {
		titleField: "gridTitle",
		imageField: "gridImage",
		calloutField: "gridCallout",
		overlineField: "gridOverline",
		primaryMetadataField: "gridPrimary",
		secondaryMetadataField: "gridSecondary",
	},
	list: {
		titleField: "listTitle",
		imageField: "listImage",
		calloutField: "listCallout",
		overlineField: "listOverline",
		primaryMetadataField: "listPrimary",
		secondaryMetadataField: "listSecondary",
	},
	table: {
		imageField: "tableImage",
		columns: [
			{ field: "tableTitle", label: "Title" },
			{ field: "tableYear", label: "Year" },
		],
	},
} satisfies SavedViewDisplayConfiguration;

const row = {
	id: { kind: "text", value: "entity-1" },
	listImage: { kind: "null", value: null },
	tableYear: { kind: "null", value: null },
	listCallout: { kind: "null", value: null },
	gridCallout: { kind: "number", value: 4.5 },
	listSecondary: { kind: "number", value: 1969 },
	gridSecondary: { kind: "boolean", value: true },
	gridTitle: { kind: "text", value: "Grid title" },
	listTitle: { kind: "text", value: "List title" },
	tableTitle: { kind: "text", value: "Table title" },
	gridPrimary: { kind: "date", value: "2026-08-12" },
	listPrimary: { kind: "json", value: { pages: 304 } },
	gridOverline: { kind: "text", value: "Grid overline" },
	listOverline: { kind: "text", value: "List overline" },
	tableImage: { kind: "json", value: { type: "s3", key: "table.jpg" } },
	gridImage: { kind: "json", value: { type: "remote", url: "https://example.com/grid.jpg" } },
} as const;

const response = (item: unknown = row) => ({
	data: {
		savedView: {
			items: [item],
			type: "rows",
			pageInfo: { page: 1, limit: 20, total: 1, hasMore: false },
		},
	},
});

describe("decodeSavedViewDisplayData", () => {
	it("maps independent card slots and ordered table cells", () => {
		const decoded = Result.getOrThrow(decodeSavedViewDisplayData(response(), configuration));

		expect(decoded.pageInfo).toEqual({ page: 1, limit: 20, total: 1, hasMore: false });
		expect(decoded.items).toEqual([
			{
				id: "entity-1",
				grid: {
					title: "Grid title",
					callout: { kind: "number", value: 4.5 },
					overline: { kind: "text", value: "Grid overline" },
					secondaryMetadata: { kind: "boolean", value: true },
					primaryMetadata: { kind: "date", value: "2026-08-12" },
					image: {
						type: "asset",
						locator: { type: "remote", url: "https://example.com/grid.jpg" },
					},
				},
				list: {
					callout: undefined,
					title: "List title",
					image: { type: "missing" },
					overline: { kind: "text", value: "List overline" },
					secondaryMetadata: { kind: "number", value: 1969 },
					primaryMetadata: { kind: "json", value: { pages: 304 } },
				},
				table: {
					image: { type: "asset", locator: { type: "s3", key: "table.jpg" } },
					cells: [
						{ label: "Title", value: { kind: "text", value: "Table title" } },
						{ label: "Year", value: { kind: "null", value: null } },
					],
				},
			},
		]);
	});

	it("keeps unconfigured images distinct from configured missing images", () => {
		const withoutImages = {
			...configuration,
			grid: { ...configuration.grid, imageField: null },
			table: { ...configuration.table, imageField: null },
		} satisfies SavedViewDisplayConfiguration;
		const decoded = Result.getOrThrow(decodeSavedViewDisplayData(response(), withoutImages));

		expect(decoded.items[0]?.grid.image).toEqual({ type: "unconfigured" });
		expect(decoded.items[0]?.list.image).toEqual({ type: "missing" });
		expect(decoded.items[0]?.table.image).toEqual({ type: "unconfigured" });
	});

	it.each([
		[
			"nested results",
			{ ...row, gridTitle: { items: [], pageInfo: { limit: 1, hasMore: false } } },
		],
		[
			"missing configured fields",
			Object.fromEntries(Object.entries(row).filter(([key]) => key !== "gridTitle")),
		],
		["malformed scalar values", { ...row, gridCallout: { kind: "number", value: "4.5" } }],
		["non-text IDs", { ...row, id: { kind: "number", value: 1 } }],
		["non-text titles", { ...row, listTitle: { kind: "boolean", value: true } }],
		["text image URLs", { ...row, gridImage: { kind: "text", value: "https://example.com" } }],
		["malformed image locators", { ...row, gridImage: { kind: "json", value: { type: "s3" } } }],
		["invalid dates", { ...row, gridPrimary: { kind: "date", value: "not-a-date" } }],
	])("rejects %s", (_name, invalidRow) => {
		expect(Result.isFailure(decodeSavedViewDisplayData(response(invalidRow), configuration))).toBe(
			true,
		);
	});

	it("rejects non-row and multiple results", () => {
		expect(
			Result.isFailure(
				decodeSavedViewDisplayData(
					{ data: { savedView: { type: "aggregate", items: [] } } },
					configuration,
				),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeSavedViewDisplayData(
					{ data: { first: response().data.savedView, second: response().data.savedView } },
					configuration,
				),
			),
		).toBe(true);
	});

	it("deduplicates managed assets and resolves image URLs", () => {
		const decoded = Result.getOrThrow(
			decodeSavedViewDisplayData(
				response({
					...row,
					tableImage: { kind: "json", value: { type: "s3", key: "cover.jpg" } },
					listImage: { kind: "json", value: { type: "local", key: "cover.jpg" } },
				}),
				configuration,
			),
		);
		const assets = collectManagedAssets([...decoded.items, ...decoded.items], "list");
		const urls = resolvedAssetUrls(
			[
				{
					asset: { type: "local", key: "cover.jpg" },
					downloadUrl: "uploads/local/download?key=cover.jpg",
				},
				{ asset: { type: "s3", key: "cover.jpg" }, downloadUrl: "https://s3.test" },
			],
			"https://server.test",
		);

		expect(assets).toEqual([{ type: "local", key: "cover.jpg" }]);
		expect(resolveSavedViewImageUrl(decoded.items[0].grid.image, urls)).toBe(
			"https://example.com/grid.jpg",
		);
		expect(resolveSavedViewImageUrl(decoded.items[0].list.image, urls)).toBe(
			"https://server.test/api/uploads/local/download?key=cover.jpg",
		);
		expect(urls.get("s3:cover.jpg")).toBe("https://s3.test/");
	});
});
