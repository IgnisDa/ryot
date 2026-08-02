import type { RyotQLResponse } from "@ryot/contract/modules/ryotql/language";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { buildNavigationDocument, decodeNavigationResponse } from "./navigation";

const navigationResponse = {
	data: {
		workspaces: {
			type: "rows",
			pageInfo: { hasMore: false, limit: 100, page: 1, total: 2 },
			items: [
				{
					name: { kind: "text", value: "Media" },
					slug: { kind: "text", value: "media" },
					sortOrder: { kind: "null", value: null },
					isDisabled: { kind: "null", value: null },
					icon: { kind: "text", value: "clapperboard" },
					accentColor: { kind: "text", value: "#fd7e14" },
				},
				{
					sortOrder: { kind: "number", value: 2 },
					name: { kind: "text", value: "Fitness" },
					slug: { kind: "text", value: "fitness" },
					icon: { kind: "text", value: "dumbbell" },
					isDisabled: { kind: "boolean", value: true },
					accentColor: { kind: "text", value: "#3d6d2f" },
				},
			],
		},
		savedViews: {
			type: "rows",
			pageInfo: { hasMore: false, limit: 100, page: 1, total: 2 },
			items: [
				{
					icon: { kind: "text", value: "film" },
					name: { kind: "text", value: "Movies" },
					slug: { kind: "text", value: "movies" },
					sortOrder: { kind: "number", value: 1 },
					pluginSlug: { kind: "text", value: "media" },
					isDisabled: { kind: "boolean", value: false },
					accentColor: { kind: "text", value: "#fd7e14" },
				},
				{
					sortOrder: { kind: "number", value: 2 },
					icon: { kind: "text", value: "bookmark" },
					pluginSlug: { kind: "null", value: null },
					name: { kind: "text", value: "Everything" },
					slug: { kind: "text", value: "everything" },
					isDisabled: { kind: "boolean", value: false },
					accentColor: { kind: "text", value: "#a24e08" },
				},
			],
		},
		collections: {
			type: "rows",
			pageInfo: { hasMore: false, limit: 100, page: 1, total: 1 },
			items: [
				{
					id: { kind: "text", value: "collection-1" },
					name: { kind: "text", value: "Sci-Fi Essentials" },
				},
			],
		},
	},
} satisfies RyotQLResponse;

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

	it("decodes focused rows and applies missing plugin-state defaults", () => {
		const data = Result.getOrThrow(decodeNavigationResponse(navigationResponse));

		expect(data.workspaces).toEqual([
			{
				sortOrder: 0,
				name: "Media",
				slug: "media",
				isDisabled: false,
				icon: "clapperboard",
				accentColor: "#fd7e14",
			},
			{
				sortOrder: 2,
				name: "Fitness",
				slug: "fitness",
				isDisabled: true,
				icon: "dumbbell",
				accentColor: "#3d6d2f",
			},
		]);
		expect(data.savedViews.map((item) => [item.slug, item.pluginSlug])).toEqual([
			["movies", "media"],
			["everything", null],
		]);
		expect(data.collections).toEqual([
			{
				sortOrder: 0,
				accentColor: "",
				pluginSlug: null,
				icon: "layers-3",
				isDisabled: false,
				slug: "collection-1",
				name: "Sci-Fi Essentials",
			},
		]);
	});

	it("decodes valid empty sections", () => {
		const emptyRows = {
			items: [],
			type: "rows" as const,
			pageInfo: { hasMore: false, limit: 100, page: 1, total: 0 },
		};

		expect(
			Result.getOrThrow(
				decodeNavigationResponse({
					data: { workspaces: emptyRows, savedViews: emptyRows, collections: emptyRows },
				}),
			),
		).toEqual({ workspaces: [], savedViews: [], collections: [] });
	});

	it("fails the complete decode when a recipe field has the wrong kind", () => {
		expect(
			Result.isFailure(
				decodeNavigationResponse({
					...navigationResponse,
					data: {
						...navigationResponse.data,
						collections: {
							...navigationResponse.data.collections,
							items: [
								{ id: { kind: "number", value: 2 }, name: { kind: "text", value: "Malformed" } },
							],
						},
					},
				}),
			),
		).toBe(true);
	});
});
