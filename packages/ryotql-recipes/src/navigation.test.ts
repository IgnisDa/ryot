import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { navigationRecipe } from "./navigation";
import { requireRowsQuery, rowsResult } from "./test-utils";

const rows = (items: readonly unknown[], limit = 100) =>
	rowsResult(items, { limit, hasMore: false, nextCursor: null });
const response = {
	data: {
		collections: rows([{ id: "collection-1", name: "Sci-Fi Essentials" }]),
		savedViews: rows([
			{
				icon: "film",
				sortOrder: 1,
				name: "Movies",
				slug: "movies",
				isHidden: false,
				pluginSlug: "media",
				pluginInstallationId: "media-workspace",
				reference: { kind: "plugin", slug: "movies", pluginId: "media-owner" },
			},
		]),
	},
};

describe("navigation recipe", () => {
	it("prepares one document with all navigation queries", () => {
		const document = navigationRecipe().document;

		expect(Object.keys(document.queries)).toEqual(["collections", "savedViews"]);
		expect(requireRowsQuery(document.queries.savedViews).output.orderBy).toEqual([
			{ direction: "asc", expr: { type: "column", field: "pluginSlug", tableAlias: "savedView" } },
			{ direction: "asc", expr: { type: "column", field: "sortOrder", tableAlias: "savedView" } },
			{ direction: "asc", expr: { field: "slug", type: "column", tableAlias: "savedView" } },
		]);
		expect(document.queries.collections).toMatchObject({
			output: { pagination: { limit: 100 } },
			from: { table: "entity", alias: "collection" },
			where: {
				predicates: [
					{ right: { value: "collection" } },
					{ type: "isNull", expr: { field: "entitySchemaPluginId" } },
				],
			},
		});
	});

	it("decodes plain values and applies navigation defaults", () => {
		expect(Result.getOrThrow(navigationRecipe().decode(response))).toEqual({
			collections: [
				{
					sortOrder: 0,
					reference: null,
					isHidden: false,
					icon: "layers-3",
					pluginSlug: null,
					slug: "collection-1",
					name: "Sci-Fi Essentials",
					pluginInstallationId: null,
				},
			],
			savedViews: [
				{
					icon: "film",
					sortOrder: 1,
					name: "Movies",
					slug: "movies",
					isHidden: false,
					pluginSlug: "media",
					pluginInstallationId: "media-workspace",
					reference: { kind: "plugin", slug: "movies", pluginId: "media-owner" },
				},
			],
		});
	});

	it("decodes empty sections", () => {
		expect(
			Result.getOrThrow(
				navigationRecipe().decode({ data: { savedViews: rows([]), collections: rows([]) } }),
			),
		).toEqual({ savedViews: [], collections: [] });
	});

	it("rejects malformed selected fields", () => {
		expect(
			Result.isFailure(
				navigationRecipe().decode({
					...response,
					data: { ...response.data, collections: rows([{ id: 2, name: "Malformed" }]) },
				}),
			),
		).toBe(true);
	});
});
