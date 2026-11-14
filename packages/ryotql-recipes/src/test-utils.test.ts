import { describe, expect, it } from "bun:test";

import { aggregate, column, document, field, rows, table } from "@ryot-app/ryotql";
import { bindDocument } from "@ryot-app/ryotql/binding";
import { Result } from "effect";

import { recipeResponse } from "./test-utils";

const bindingNow = new Date("2026-01-01T00:00:00Z");
const entity = table("entity", "entity");
const recipe = {
	document: document({
		items: rows(entity, { limit: 7, fields: [field("id", column(entity, "id"))] }),
		total: aggregate(entity, { measures: [{ key: "count", aggregation: { function: "count" } }] }),
		grouped: aggregate(entity, {
			limit: 4,
			groupBy: [field("name", column(entity, "name"))],
			measures: [{ key: "count", aggregation: { function: "count" } }],
		}),
	}),
};

describe("recipe response fixtures", () => {
	it("fills rows and grouped results while retaining explicit scalar aggregates", () => {
		const total = { type: "aggregate", items: [{ count: 3 }] };
		const response = recipeResponse(recipe, { total });
		expect(response.data).toEqual({
			total,
			items: { items: [], type: "rows", pageInfo: { limit: 7, hasMore: false, nextCursor: null } },
			grouped: {
				items: [],
				type: "aggregate",
				pageInfo: { limit: 4, hasMore: false, nextCursor: null },
			},
		});
		expect(response.data["total"]).toBe(total);
	});
	it("accepts the executable document returned by canonical binding", () => {
		const bound = Result.getOrThrow(
			bindDocument(recipe.document, {}, { now: bindingNow, reportingTimeZone: "UTC" }),
		);
		expect(
			recipeResponse(
				{ document: bound.document },
				{ total: { type: "aggregate", items: [{ count: 0 }] } },
			).data["items"],
		).toEqual({
			items: [],
			type: "rows",
			pageInfo: { limit: 7, hasMore: false, nextCursor: null },
		});
	});

	it("retains malformed overrides verbatim and refuses to invent scalar aggregate values", () => {
		const malformed = { items: "malformed" };
		const response = recipeResponse(recipe, { total: null, items: malformed, grouped: undefined });
		expect(response.data["items"]).toBe(malformed);
		expect(Object.hasOwn(response.data, "grouped")).toBe(true);
		expect(response.data["grouped"]).toBeUndefined();
		expect(response.data["total"]).toBeNull();
		expect(() => recipeResponse(recipe)).toThrow("Supply an explicit aggregate result for 'total'");
	});
});
