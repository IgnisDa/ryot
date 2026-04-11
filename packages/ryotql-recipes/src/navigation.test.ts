import { describe, expect, it } from "vitest";

import { buildNavigationDocument } from "./navigation";

describe("navigation recipe", () => {
	it("builds independent focused workspace, saved-view, and collection queries", () => {
		const document = buildNavigationDocument();

		expect(Object.keys(document.queries)).toEqual(["workspaces", "savedViews", "collections"]);
		expect(document.queries.workspaces).toMatchObject({
			from: { alias: "plugin", table: "plugin" },
			where: {
				operator: "eq",
				right: { type: "literal", value: "active" },
				left: { field: "status", tableAlias: "plugin" },
			},
			joins: [
				{
					type: "left",
					table: { alias: "state", table: "pluginState" },
					on: {
						left: { field: "slug", tableAlias: "plugin" },
						right: { field: "pluginSlug", tableAlias: "state" },
					},
				},
			],
			output: {
				pagination: { page: 1, limit: 100 },
				fields: [
					{ key: "slug" },
					{ key: "name" },
					{ key: "icon" },
					{ key: "accentColor" },
					{ key: "sortOrder" },
					{ key: "isDisabled" },
				],
			},
		});
		expect(document.queries.workspaces.output.orderBy).toEqual([
			{ direction: "asc", expr: { type: "column", tableAlias: "plugin", field: "ingestedAt" } },
			{ direction: "asc", expr: { type: "column", tableAlias: "plugin", field: "slug" } },
		]);
		expect(document.queries.savedViews.output.fields.map(({ key }) => key)).toEqual([
			"slug",
			"name",
			"icon",
			"accentColor",
			"sortOrder",
			"isDisabled",
			"pluginSlug",
		]);
		expect(document.queries.savedViews.output.orderBy).toEqual([
			{ direction: "asc", expr: { type: "column", tableAlias: "savedView", field: "pluginSlug" } },
			{ direction: "asc", expr: { type: "column", tableAlias: "savedView", field: "sortOrder" } },
			{ direction: "asc", expr: { type: "column", tableAlias: "savedView", field: "createdAt" } },
		]);
		expect(document.queries.collections).toMatchObject({
			from: { alias: "collection", table: "entity" },
			output: { pagination: { page: 1, limit: 100 } },
		});
	});
});
