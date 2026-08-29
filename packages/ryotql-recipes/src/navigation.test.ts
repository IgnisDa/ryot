import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { navigationRecipe } from "./navigation";
import { requireRowsQuery, rowsResult } from "./test-utils";

const rows = (items: readonly unknown[], limit = 100) =>
	rowsResult(items, { hasMore: false, limit, nextCursor: null });
const response = {
	data: {
		savedViews: rows([
			{
				icon: "film",
				name: "Movies",
				slug: "movies",
				sortOrder: 1,
				pluginSlug: "media",
				isDisabled: false,
			},
		]),
		collections: rows([{ id: "collection-1", name: "Sci-Fi Essentials" }]),
	},
};

describe("navigation recipe", () => {
	it("prepares one document with all navigation queries", () => {
		const document = navigationRecipe().document;

		expect(Object.keys(document.queries)).toEqual(["savedViews", "collections"]);
		expect(requireRowsQuery(document.queries.savedViews).output.orderBy).toEqual([
			{ direction: "asc", expr: { field: "pluginSlug", tableAlias: "savedView", type: "column" } },
			{ direction: "asc", expr: { field: "sortOrder", tableAlias: "savedView", type: "column" } },
			{ direction: "asc", expr: { field: "createdAt", tableAlias: "savedView", type: "column" } },
		]);
		expect(document.queries.collections).toMatchObject({
			output: { pagination: { limit: 100 } },
			where: { right: { value: "collection" } },
			from: { alias: "collection", table: "entity" },
		});
	});

	it("decodes plain values and applies navigation defaults", () => {
		expect(Result.getOrThrow(navigationRecipe().decode(response))).toEqual({
			savedViews: [
				{
					icon: "film",
					sortOrder: 1,
					name: "Movies",
					slug: "movies",
					isDisabled: false,
					pluginSlug: "media",
				},
			],
			collections: [
				{
					sortOrder: 0,
					icon: "layers-3",
					pluginSlug: null,
					isDisabled: false,
					slug: "collection-1",
					name: "Sci-Fi Essentials",
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
