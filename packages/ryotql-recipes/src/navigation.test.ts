import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { navigationRecipe } from "./navigation";
import { requireRowsQuery, rowsResult } from "./test-utils";

const rows = (items: readonly unknown[], limit = 100) =>
	rowsResult(items, { hasMore: false, limit, nextCursor: null });
const response = {
	data: {
		workspaces: rows([
			{ name: "Media", slug: "media", sortOrder: null, isDisabled: null, icon: "clapperboard" },
			{ name: "Fitness", slug: "fitness", sortOrder: 2, isDisabled: true, icon: "dumbbell" },
		]),
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

		expect(Object.keys(document.queries)).toEqual(["workspaces", "savedViews", "collections"]);
		expect(document.queries.workspaces).toMatchObject({
			from: { alias: "plugin", table: "plugin" },
			output: { pagination: { limit: 100 } },
			where: { right: { value: "active" } },
		});
		expect(requireRowsQuery(document.queries.savedViews).output.orderBy).toEqual([
			{ direction: "asc", expr: { field: "pluginSlug", tableAlias: "savedView", type: "column" } },
			{ direction: "asc", expr: { field: "sortOrder", tableAlias: "savedView", type: "column" } },
			{ direction: "asc", expr: { field: "createdAt", tableAlias: "savedView", type: "column" } },
		]);
	});

	it("decodes plain values and applies navigation defaults", () => {
		expect(Result.getOrThrow(navigationRecipe().decode(response))).toEqual({
			workspaces: [
				{ name: "Media", slug: "media", sortOrder: 0, isDisabled: false, icon: "clapperboard" },
				{ name: "Fitness", slug: "fitness", sortOrder: 2, isDisabled: true, icon: "dumbbell" },
			],
			savedViews: [
				{
					icon: "film",
					name: "Movies",
					slug: "movies",
					sortOrder: 1,
					pluginSlug: "media",
					isDisabled: false,
				},
			],
			collections: [
				{
					name: "Sci-Fi Essentials",
					slug: "collection-1",
					sortOrder: 0,
					icon: "layers-3",
					pluginSlug: null,
					isDisabled: false,
				},
			],
		});
	});

	it("decodes empty sections", () => {
		expect(
			Result.getOrThrow(
				navigationRecipe().decode({
					data: { workspaces: rows([]), savedViews: rows([]), collections: rows([]) },
				}),
			),
		).toEqual({ workspaces: [], savedViews: [], collections: [] });
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
