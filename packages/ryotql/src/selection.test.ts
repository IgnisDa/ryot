import { describe, expect, it } from "bun:test";

import { Result, Schema } from "effect";

import { column, defineRecipe, selectedField, selectedRows, selectRecipe, table } from "./index";

const entity = table("entity", "entity");
const recipe = defineRecipe({
	map: () => Result.fail(new Error("Full-document map")),
	queries: {
		items: selectedRows(entity, {
			selection: { id: selectedField(column(entity, "id"), Schema.String) },
		}),
		other: selectedRows(entity, {
			selection: { name: selectedField(column(entity, "name"), Schema.String) },
		}),
	},
});
const pageInfo = { limit: 20, hasMore: false, nextCursor: null };

describe("recipe selection", () => {
	it("shares the full document and decodes only the selected result without running map", () => {
		const selected = selectRecipe(recipe, "items");
		expect(selected.document).toBe(recipe.document);
		expect(selected.parameters).toBe(recipe.parameters);
		expect(selected.query).toBe("items");
		const response = { data: { items: { pageInfo, type: "rows", items: [{ id: "one" }] } } };
		expect(Result.getOrThrow(selected.decode(response))).toEqual({
			pageInfo,
			items: [{ id: "one" }],
		});
		expect(Result.isFailure(recipe.decode(response))).toBe(true);
	});
	it("rejects missing, malformed and undecodable selected results", () => {
		const selected = selectRecipe(recipe, "items");
		for (const response of [
			null,
			{},
			{ data: {} },
			{ data: { items: null } },
			{ data: { items: { pageInfo, type: "rows", items: [{ id: 1 }] } } },
		]) {
			expect(Result.isFailure(selected.decode(response))).toBe(true);
		}
	});
});
