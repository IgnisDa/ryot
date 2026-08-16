import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { savedViewRecordRecipe, savedViewRecordsRecipe } from "./saved-view-records";
import { requireRowsQuery, rowsResult } from "./test-utils";

const item = {
	id: "view-1",
	sortOrder: 2,
	settings: {},
	slug: "view-one",
	name: "View One",
	icon: "bookmark",
	isBuiltin: false,
	dataSources: null,
	isDisabled: false,
	pluginSlug: "media",
	createdAt: "2026-01-01T01:00:00+02:00",
	updatedAt: "2026-01-02T01:00:00+02:00",
	renderer: { kind: "kernel", name: "entity-browser" },
};
const pageInfo = { limit: 2, hasMore: true, nextCursor: "next" };
const rows = (items: readonly unknown[], limit = 2) => rowsResult(items, { ...pageInfo, limit });

describe("saved-view record recipes", () => {
	it("prepares list filters, fields, pagination, and ordering", () => {
		const query = requireRowsQuery(
			savedViewRecordsRecipe({
				limit: 7,
				after: "cursor",
				pluginSlug: "media",
				includeDisabled: false,
			}).document.queries.savedViews,
		);

		expect(query.output.pagination).toEqual({ limit: 7, after: "cursor" });
		expect(query.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
			"id",
			"slug",
			"name",
			"icon",
			"sortOrder",
			"isBuiltin",
			"renderer",
			"isDisabled",
			"pluginSlug",
			"createdAt",
			"updatedAt",
			"dataSources",
			"settings",
		]);
		expect(query.where).toMatchObject({
			predicates: [
				{ right: { value: false }, left: { field: "isDisabled" } },
				{ right: { value: "media" }, left: { field: "pluginSlug" } },
			],
		});
	});

	it("prepares optional detail with cardinality limit two", () => {
		const query = requireRowsQuery(
			savedViewRecordRecipe({ slug: "view-one" }).document.queries.savedView,
		);

		expect(query.output.pagination).toEqual({ limit: 2 });
		expect(query.where).toMatchObject({ left: { field: "slug" }, right: { value: "view-one" } });
	});

	it("decodes plain records, page info, nulls, and normalized dates", () => {
		const decoded = Result.getOrThrow(
			savedViewRecordsRecipe({ limit: 2 }).decode({ data: { savedViews: rows([item]) } }),
		);

		expect(decoded).toEqual({
			pageInfo,
			items: [
				{ ...item, createdAt: "2025-12-31T23:00:00.000Z", updatedAt: "2026-01-01T23:00:00.000Z" },
			],
		});
		expect(
			Result.getOrThrow(
				savedViewRecordsRecipe({ limit: 2 }).decode({
					data: { savedViews: rows([{ ...item, pluginSlug: null }]) },
				}),
			).items[0],
		).toMatchObject({ pluginSlug: null });
	});

	it("decodes optional detail and rejects excess cardinality", () => {
		const recipe = savedViewRecordRecipe({ slug: "view-one" });

		expect(Result.getOrThrow(recipe.decode({ data: { savedView: rows([], 2) } }))).toBeUndefined();
		expect(Result.isFailure(recipe.decode({ data: { savedView: rows([item, item], 2) } }))).toBe(
			true,
		);
	});

	it("rejects malformed JSON and dates", () => {
		const recipe = savedViewRecordsRecipe({ limit: 2 });

		for (const malformed of [
			{ ...item, renderer: "not-json" },
			{ ...item, settings: "not-json" },
			{ ...item, dataSources: "not-json" },
			{ ...item, createdAt: "not-a-date" },
			{ ...item, updatedAt: "not-a-date" },
		]) {
			expect(Result.isFailure(recipe.decode({ data: { savedViews: rows([malformed]) } }))).toBe(
				true,
			);
		}
	});

	it("rejects missing fields and wrong result shapes", () => {
		const malformed = { ...item } as Record<string, unknown>;
		delete malformed.id;
		const recipe = savedViewRecordsRecipe({ limit: 2 });

		expect(Result.isFailure(recipe.decode({ data: { savedViews: rows([malformed]) } }))).toBe(true);
		expect(Result.isFailure(recipe.decode({ data: {} }))).toBe(true);
		expect(
			Result.isFailure(
				recipe.decode({ data: { savedViews: { ...rows([item]), type: "aggregate" } } }),
			),
		).toBe(true);
	});
});
